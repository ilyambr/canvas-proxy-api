const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const serverless = require('serverless-http');

const app = express();

// Only allow your GitHub Pages origin:
const corsOptions = {
  origin: 'https://ilyambr.me',
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
};

app.use(cors(corsOptions));
// Handle the OPTIONS “preflight” request for POST /api/grades:
app.options('/', cors(corsOptions));

app.use(express.json());

app.post('/', async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'Missing token' });
  }

  try {
    // 1) Fetch all courses:
    const courseRes = await fetch('https://providencepsd.instructure.com/api/v1/courses', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!courseRes.ok) {
      throw new Error(`Canvas returned ${courseRes.status} while fetching courses`);
    }
    const courses = await courseRes.json();

    // 2) Loop through and get grades:
    const grades = [];
    for (let course of courses) {
      let enrollRes = await fetch(
        `https://providencepsd.instructure.com/api/v1/courses/${course.id}/enrollments`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!enrollRes.ok) {
        console.warn(`Skipping course ${course.id} (status ${enrollRes.status})`);
        continue;
      }
      let enrollments = await enrollRes.json();
      let student = enrollments.find(e => e.type === 'StudentEnrollment');
      if (student && student.grades) {
        grades.push({
          course: course.name,
          grade: student.grades.current_grade || 'N/A',
          score: student.grades.current_score || 'N/A'
        });
      }
    }

    return res.json(grades);
  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Wrap the Express app in serverless-http so Vercel actually runs it:
module.exports = serverless(app);
