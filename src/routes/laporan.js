const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { verifyToken, requireRole } = require('../middleware/auth');
const { analyzeSymptomsAndSave } = require('../services/llm');

// POST /api/laporan  — Buat laporan baru & langsung analisis LLM
router.post('/', verifyToken, requireRole('pasien'), async (req, res) => {
  const { keluhan_pasien } = req.body;

  if (!keluhan_pasien || keluhan_pasien.trim() === '') {
    return res.status(400).json({ success: false, message: 'Keluhan pasien wajib diisi' });
  }

  const pasienId = req.user.id;
  const lokasiPasien = {
    rt: req.user.no_rt,
    rw: req.user.no_rw,
    kelurahan: req.user.kelurahan,
    kecamatan: req.user.kecamatan
  };

  let laporanId;

  try {
    // 1. Simpan laporan ke database
    const [result] = await pool.execute(
      `INSERT INTO laporan_penyakit 
        (pasien_id, keluhan_pasien, lapor_rt, lapor_rw, tanggal_lapor, status_konfirmasi)
       VALUES (?, ?, ?, ?, CURDATE(), 'menunggu')`,
      [pasienId, keluhan_pasien.trim(), lokasiPasien.rt, lokasiPasien.rw]
    );
    laporanId = result.insertId;

    // 2. Panggil LLM dan simpan hasilnya ke database
    const analisisLlm = await analyzeSymptomsAndSave(laporanId, keluhan_pasien.trim(), lokasiPasien);

    res.status(201).json({
      success: true,
      message: 'Laporan berhasil dibuat dan dianalisis',
      data: {
        laporan_id: laporanId,
        keluhan: keluhan_pasien,
        analisis_llm: analisisLlm,
        status_konfirmasi: 'menunggu',
        peringatan: 'Analisis ini bersifat sementara dan WAJIB dikonfirmasi oleh dokter atau tenaga kesehatan.'
      }
    });

  } catch (err) {
    // Jika LLM gagal, laporan tetap tersimpan tapi tanpa analisis
    console.error('Error membuat laporan:', err.message);
    if (laporanId) {
      return res.status(207).json({
        success: false,
        message: 'Laporan tersimpan, namun analisis AI gagal. Silakan coba lagi.',
        data: { laporan_id: laporanId }
      });
    }
    res.status(500).json({ success: false, message: 'Gagal membuat laporan' });
  }
});

// GET /api/laporan/saya  — Pasien lihat laporan miliknya
router.get('/saya', verifyToken, requireRole('pasien'), async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT 
         lp.id, lp.keluhan_pasien, lp.status_konfirmasi,
         lp.diagnosis_final, lp.penyebab_lingkungan, lp.catatan_medis,
         lp.hasil_analisis_llm, lp.tanggal_lapor, lp.tanggal_konfirmasi,
         u.nama_lengkap AS nama_pemeriksa
       FROM laporan_penyakit lp
       LEFT JOIN users u ON lp.pemeriksa_id = u.id
       WHERE lp.pasien_id = ?
       ORDER BY lp.created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Gagal mengambil data laporan' });
  }
});

// GET /api/laporan/:id  — Lihat detail laporan (pasien hanya bisa lihat miliknya)
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT 
         lp.*, u.nama_lengkap AS nama_pemeriksa,
         p.nama_lengkap AS nama_pasien
       FROM laporan_penyakit lp
       LEFT JOIN users u ON lp.pemeriksa_id = u.id
       LEFT JOIN users p ON lp.pasien_id = p.id
       WHERE lp.id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Laporan tidak ditemukan' });
    }

    const laporan = rows[0];

    // Pasien hanya bisa lihat laporannya sendiri
    if (req.user.role === 'pasien' && laporan.pasien_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    res.json({ success: true, data: laporan });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Gagal mengambil data laporan' });
  }
});

module.exports = router;