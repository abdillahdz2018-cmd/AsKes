const axios = require('axios');
const pool = require('../config/database');
require('dotenv').config();

/**
 * Memanggil LLM untuk mendapatkan analisis kesehatan berdasarkan keluhan pasien,
 * kemudian menyimpan hasil ke database pada tabel laporan_penyakit.
 */
async function analyzeSymptomsAndSave(laporanId, keluhanPasien, lokasiPasien) {
  const prompt = `
Kamu adalah asisten kesehatan berbasis AI. Tugasmu memberikan analisis awal atas keluhan pasien.
Berikan respons dalam format JSON yang valid dan HANYA JSON, tanpa teks tambahan apapun.

Data Pasien:
- Keluhan: "${keluhanPasien}"
- Lokasi: RT ${lokasiPasien.rt} / RW ${lokasiPasien.rw}, ${lokasiPasien.kelurahan}, ${lokasiPasien.kecamatan}

Berikan analisis dengan struktur JSON berikut:
{
  "diagnosis_sementara": "string - diagnosis awal yang paling mungkin",
  "kemungkinan_penyakit": ["string", "string"],
  "rekomendasi_tindakan": ["string - tindakan 1", "string - tindakan 2"],
  "penyebab_lingkungan": "string - kemungkinan penyebab dari faktor lingkungan setempat",
  "fasilitas_kesehatan_terdekat": [
    {
      "nama": "string",
      "jenis": "string (Puskesmas/Klinik/RS)",
      "estimasi_jarak": "string"
    }
  ],
  "tingkat_urgensi": "string (Rendah/Sedang/Tinggi)",
  "catatan": "string - peringatan bahwa ini bukan diagnosis final dan harus dikonfirmasi dokter"
}
`;

  try {
    // 1. Panggil LLM
    const response = await axios.post(
      `${process.env.LLM_BASE_URL}/chat/completions`,
      {
        model: process.env.LLM_MODEL,
        messages: [
          {
            role: 'system',
            content: 'Kamu adalah asisten kesehatan AI. Selalu jawab dalam format JSON valid saja tanpa markdown, tanpa kode blok, tanpa penjelasan tambahan.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 1000
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.LLM_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // 2. Parse hasil LLM
    const rawContent = response.data.choices[0].message.content;
    console.log('Raw response LLM:', rawContent);
    let analysisResult;

try {
      const cleaned = rawContent.replace(/```json|```/g, '').trim();
      // Cari JSON object di dalam response
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Tidak ada JSON ditemukan');
      analysisResult = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Gagal parse JSON dari LLM:', rawContent);
      throw new Error('Format respons LLM tidak valid');
    }

    // 3. Simpan hasil LLM ke database
    const llmResultJson = JSON.stringify(analysisResult);

    await pool.execute(
      `UPDATE laporan_penyakit 
       SET hasil_analisis_llm = ?, status_konfirmasi = 'menunggu', updated_at = NOW()
       WHERE id = ?`,
      [llmResultJson, laporanId]
    );

    return analysisResult;

    } catch (error) {
        console.error('Error pada LLM service:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Detail:', JSON.stringify(error.response.data));
        }
        throw error;
    }
}

module.exports = { analyzeSymptomsAndSave };