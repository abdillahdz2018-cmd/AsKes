const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { verifyToken, requireRole } = require('../middleware/auth');

// GET /api/nakes/laporan  — Lihat semua laporan yang menunggu konfirmasi
router.get('/laporan', verifyToken, requireRole('nakes'), async (req, res) => {
  const { status } = req.query; // filter: menunggu | terkonfirmasi | ditolak
  const allowedStatus = ['menunggu', 'terkonfirmasi', 'ditolak'];
  const filterStatus = allowedStatus.includes(status) ? status : 'menunggu';

  try {
    const [rows] = await pool.execute(
      `SELECT 
         lp.id, lp.keluhan_pasien, lp.status_konfirmasi,
         lp.diagnosis_final, lp.penyebab_lingkungan,
         lp.lapor_rt, lp.lapor_rw, lp.tanggal_lapor,
         lp.hasil_analisis_llm,
         u.nama_lengkap AS nama_pasien, u.no_telepon
       FROM laporan_penyakit lp
       JOIN users u ON lp.pasien_id = u.id
       WHERE lp.status_konfirmasi = ?
       ORDER BY lp.created_at ASC`,
      [filterStatus]
    );
    res.json({ success: true, total: rows.length, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Gagal mengambil data' });
  }
});

// PUT /api/nakes/laporan/:id/konfirmasi  — Konfirmasi atau tolak laporan
router.put('/laporan/:id/konfirmasi', verifyToken, requireRole('nakes'), async (req, res) => {
  const { status_konfirmasi, diagnosis_final, penyebab_lingkungan, catatan_medis } = req.body;
  const laporanId = req.params.id;

  if (!['terkonfirmasi', 'ditolak'].includes(status_konfirmasi)) {
    return res.status(400).json({ success: false, message: 'Status harus "terkonfirmasi" atau "ditolak"' });
  }

  if (status_konfirmasi === 'terkonfirmasi' && (!diagnosis_final || !penyebab_lingkungan)) {
    return res.status(400).json({
      success: false,
      message: 'Diagnosis final dan penyebab lingkungan wajib diisi saat mengkonfirmasi'
    });
  }

  try {
    const [result] = await pool.execute(
      `UPDATE laporan_penyakit
       SET status_konfirmasi = ?,
           pemeriksa_id = ?,
           diagnosis_final = ?,
           penyebab_lingkungan = ?,
           catatan_medis = ?,
           tanggal_konfirmasi = CURDATE(),
           updated_at = NOW()
       WHERE id = ?`,
      [
        status_konfirmasi,
        req.user.id,
        diagnosis_final || null,
        penyebab_lingkungan || null,
        catatan_medis || null,
        laporanId
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Laporan tidak ditemukan' });
    }

    res.json({
      success: true,
      message: `Laporan berhasil ${status_konfirmasi === 'terkonfirmasi' ? 'dikonfirmasi' : 'ditolak'}`
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Gagal memperbarui laporan' });
  }
});

module.exports = router;