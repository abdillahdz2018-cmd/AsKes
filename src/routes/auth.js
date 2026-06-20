const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
require('dotenv').config();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const {
    username, email, password, nama_lengkap,
    role, no_rt, no_rw, kelurahan, kecamatan, no_telepon
  } = req.body;

  if (!username || !email || !password || !nama_lengkap || !no_rt || !no_rw || !kelurahan || !kecamatan) {
    return res.status(400).json({ success: false, message: 'Semua field wajib diisi' });
  }

  const allowedRoles = ['pasien', 'nakes', 'admin_rt', 'admin_rw'];
  if (role && !allowedRoles.includes(role)) {
    return res.status(400).json({ success: false, message: 'Role tidak valid' });
  }

  try {
    const password_hash = await bcrypt.hash(password, 10);
    const [result] = await pool.execute(
      `INSERT INTO users (username, email, password_hash, nama_lengkap, role, no_rt, no_rw, kelurahan, kecamatan, no_telepon)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [username, email, password_hash, nama_lengkap, role || 'pasien', no_rt, no_rw, kelurahan, kecamatan, no_telepon || null]
    );

    res.status(201).json({
      success: true,
      message: 'Registrasi berhasil',
      data: { id: result.insertId, username, email, role: role || 'pasien' }
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'Username atau email sudah terdaftar' });
    }
    console.error(err);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email dan password wajib diisi' });
  }

  try {
    const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Email atau password salah' });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Email atau password salah' });
    }

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        no_rt: user.no_rt,
        no_rw: user.no_rw,
        kelurahan: user.kelurahan,
        kecamatan: user.kecamatan
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'Login berhasil',
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          nama_lengkap: user.nama_lengkap,
          email: user.email,
          role: user.role,
          no_rt: user.no_rt,
          no_rw: user.no_rw,
          kelurahan: user.kelurahan,
          kecamatan: user.kecamatan
        }
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
  }
});

// GET /api/auth/profile  (perlu token)
router.get('/profile', require('../middleware/auth').verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, username, email, nama_lengkap, role, no_rt, no_rw, kelurahan, kecamatan, no_telepon, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
  }
});

module.exports = router;