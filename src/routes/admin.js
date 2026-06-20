const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { verifyToken, requireRole } = require('../middleware/auth');

// GET /api/admin/rekap  — Rekapitulasi penyakit terkonfirmasi di wilayah admin
router.get('/rekap', verifyToken, requireRole('admin_rt', 'admin_rw'), async (req, res) => {
  const { rw, rt } = req.user;

  try {
    let query, params;

    if (req.user.role === 'admin_rw') {
      // Admin RW: lihat seluruh wilayah RW-nya
      query = `
        SELECT 
          diagnosis_final,
          penyebab_lingkungan,
          COUNT(*) AS jumlah_penderita,
          GROUP_CONCAT(DISTINCT lapor_rt ORDER BY lapor_rt ASC SEPARATOR ', ') AS rt_terdampak,
          MAX(tanggal_konfirmasi) AS konfirmasi_terakhir
        FROM laporan_penyakit
        WHERE lapor_rw = ? AND status_konfirmasi = 'terkonfirmasi'
        GROUP BY diagnosis_final, penyebab_lingkungan
        ORDER BY jumlah_penderita DESC
      `;
      params = [rw];
    } else {
      // Admin RT: hanya wilayah RT-nya sendiri
      query = `
        SELECT 
          diagnosis_final,
          penyebab_lingkungan,
          COUNT(*) AS jumlah_penderita,
          MAX(tanggal_konfirmasi) AS konfirmasi_terakhir
        FROM laporan_penyakit
        WHERE lapor_rw = ? AND lapor_rt = ? AND status_konfirmasi = 'terkonfirmasi'
        GROUP BY diagnosis_final, penyebab_lingkungan
        ORDER BY jumlah_penderita DESC
      `;
      params = [rw, rt];
    }

    const [rows] = await pool.execute(query, params);
    res.json({ success: true, wilayah: { rt, rw }, total_kasus_unik: rows.length, data: rows });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Gagal mengambil rekap' });
  }
});

// GET /api/admin/tindakan  — Lihat semua tindakan lingkungan di wilayah admin
router.get('/tindakan', verifyToken, requireRole('admin_rt', 'admin_rw'), async (req, res) => {
  const { no_rt, no_rw, role } = req.user;
  try {
    let query, params;

    if (role === 'admin_rw') {
      query = `
        SELECT tl.*, u.nama_lengkap AS nama_pembuat
        FROM tindakan_lingkungan tl
        JOIN users u ON tl.pembuat_id = u.id
        WHERE tl.target_rw = ?
        ORDER BY tl.tanggal_rencana ASC
      `;
      params = [no_rw];
    } else {
      query = `
        SELECT tl.*, u.nama_lengkap AS nama_pembuat
        FROM tindakan_lingkungan tl
        JOIN users u ON tl.pembuat_id = u.id
        WHERE tl.target_rw = ? AND tl.target_rt = ?
        ORDER BY tl.tanggal_rencana ASC
      `;
      params = [no_rw, no_rt];
    }

    const [rows] = await pool.execute(query, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Gagal mengambil data tindakan' });
  }
});

// POST /api/admin/tindakan  — Buat tindakan lingkungan baru
router.post('/tindakan', verifyToken, requireRole('admin_rt', 'admin_rw'), async (req, res) => {
  const { target_rt, target_rw, jenis_tindakan, deskripsi_kegiatan, tanggal_rencana } = req.body;

  const allowedJenis = ['Kerja Bakti', 'Fogging', 'Penyuluhan Sanitasi', 'Pembagian Abate', 'Lainnya'];
  if (!allowedJenis.includes(jenis_tindakan)) {
    return res.status(400).json({ success: false, message: 'Jenis tindakan tidak valid' });
  }

  if (!target_rt || !target_rw || !deskripsi_kegiatan || !tanggal_rencana) {
    return res.status(400).json({ success: false, message: 'Semua field wajib diisi' });
  }

  // Admin RT hanya bisa membuat tindakan untuk RT-nya sendiri
  if (req.user.role === 'admin_rt' && (target_rt !== req.user.no_rt || target_rw !== req.user.no_rw)) {
    return res.status(403).json({ success: false, message: 'Anda hanya dapat membuat tindakan untuk wilayah RT Anda' });
  }

  // Admin RW hanya bisa membuat tindakan di RW-nya
  if (req.user.role === 'admin_rw' && target_rw !== req.user.no_rw) {
    return res.status(403).json({ success: false, message: 'Anda hanya dapat membuat tindakan untuk wilayah RW Anda' });
  }

  try {
    const [result] = await pool.execute(
      `INSERT INTO tindakan_lingkungan 
        (pembuat_id, target_rt, target_rw, jenis_tindakan, deskripsi_kegiatan, tanggal_rencana)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.id, target_rt, target_rw, jenis_tindakan, deskripsi_kegiatan, tanggal_rencana]
    );
    res.status(201).json({
      success: true,
      message: 'Tindakan lingkungan berhasil dibuat',
      data: { id: result.insertId }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Gagal membuat tindakan' });
  }
});

// PUT /api/admin/tindakan/:id/status  — Update status tindakan
router.put('/tindakan/:id/status', verifyToken, requireRole('admin_rt', 'admin_rw'), async (req, res) => {
  const { status_tindakan } = req.body;
  const allowedStatus = ['Direncanakan', 'Berjalan', 'Selesai', 'Batal'];

  if (!allowedStatus.includes(status_tindakan)) {
    return res.status(400).json({ success: false, message: 'Status tidak valid' });
  }

  try {
    const [result] = await pool.execute(
      `UPDATE tindakan_lingkungan SET status_tindakan = ?, updated_at = NOW()
       WHERE id = ? AND pembuat_id = ?`,
      [status_tindakan, req.params.id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Tindakan tidak ditemukan atau bukan milik Anda' });
    }

    res.json({ success: true, message: 'Status tindakan berhasil diperbarui' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Gagal memperbarui status' });
  }
});

module.exports = router;