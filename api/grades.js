// File: api/grades.js
const express = require('express');
const fetch = require('node-fetch'); // or if using Node 18+, you can drop this require
const cors = require('cors');
const serverless = require('serverless-http');

const app = express();

// Strictly allow only your origin to call this proxy:
app.use(
  cors({
    origin: 'https://ilyambr.me',
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  })
);
app.options('/api/grades', cors()); // handle OPTIONS preflight

app.use(express.json());

app.post('/api/grades', async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'Missing token' });
  }

  try {
    // 1) Fetch all courses for this user
    const coursesRes = await fetch(
      'https://providencepsd.instructure.com/api/v1/courses',
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (!coursesRes.ok) {
      throw new Error(
        `Failed to fetch courses. Status: ${coursesRes.status}`
      );
    }
    const courses = await coursesRes.json();
    // courses is an array of objects like: { id: 34917, name: "ITALIAN II-CAPRIO", ... }

    const results = [];

    // 2) For each course, we want to pull that course’s assignments
    for (const course of courses) {
      const courseId = course.id;
      const courseName = course.name;

      // 2a) Fetch this course's assignments list:
      //      GET /api/v1/courses/:course_id/assignments
      const assignmentsRes = await fetch(
        `https://providencepsd.instructure.com/api/v1/courses/${courseId}/assignments`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      // If the call fails, we’ll treat it as “no assignments” rather than crashing
      let assignments = [];
      if (assignmentsRes.ok) {
        const rawList = await assignmentsRes.json();
        // rawList is an array of assignment objects:
        //   [ { id: 435432, name: "Direct Object Pronouns", points_possible: 40, … }, … ]
        // We’ll only extract the minimal fields we need
        assignments = rawList.map((a) => ({
          id: a.id,
          name: a.name,
          points_possible: a.points_possible,
        }));
      } else {
        console.warn(
          `Warning: failed to fetch assignments for course ${courseId} (status ${assignmentsRes.status}).`
        );
        assignments = [];
      }

      // 3) Push a summary object into results
      results.push({
        course_id: courseId,
        course_name: courseName,
        assignments: assignments,
      });
    }

    // 4) Return the array of course‐with‐assignments
    return res.json(results);
  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = serverless(app);
