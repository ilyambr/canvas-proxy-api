const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const serverless = require('serverless-http'); // this is critical!

const app = express();

// CORS header specifically for your GitHub Pages
app.use(cors({
  origin: 'https://ilyambr.me'
}));

app.use(express.json());

app.post('/api/grades', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Missing token' });

  try {
    const courseRes = await fetch('https://providencepsd.instructure.com/api/v1/courses', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const courses = await courseRes.json();
    const grades = [];

    for (let course of courses) {
      const enrollRes = await fetch(`https://providencepsd.instructure.com/api/v1/courses/${course.id}/enrollments`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const enrollments = await enrollRes.json();
      const student = enrollments.find(e => e.type === 'StudentEnrollment');

      if (student && student.grades) {
        grades.push({
          course: course.name,
          grade: student.grades.current_grade,
          score: student.grades.current_score
        });
      }
    }

    res.json(grades);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ must wrap app in serverless-http for Vercel to respect CORS
module.exports = serverless(app);
