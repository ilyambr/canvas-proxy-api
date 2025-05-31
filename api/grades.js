const express = require('express');
const fetch = require('node-fetch');    // or global fetch if using Node 18+
const cors = require('cors');
const serverless = require('serverless-http');

const app = express();

// 1️⃣ Allow your website (https://ilyambr.me) to call this endpoint:
app.use(
  cors({
    origin: 'https://ilyambr.me',
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  })
);
app.options('/api/grades', cors()); // Preflight support

app.use(express.json());

app.post('/api/grades', async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'Missing token' });
  }

  try {
    // 2️⃣ Fetch your list of courses from Canvas:
    const courseRes = await fetch(
      'https://providencepsd.instructure.com/api/v1/courses',
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (!courseRes.ok) {
      throw new Error(`Courses fetch failed (status ${courseRes.status})`);
    }
    const courses = await courseRes.json(); // array of { id, name, … }

    // 3️⃣ For each course, fetch enrollment (with current_grade) AND assignments (with submission)
    const results = [];

    for (const course of courses) {
      // --- Fetch the StudentEnrollment including grades.
      const enrollRes = await fetch(
        `https://providencepsd.instructure.com/api/v1/courses/${course.id}/enrollments?` +
          `type[]=StudentEnrollment&include[]=grades`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (!enrollRes.ok) {
        console.warn(
          `Enrollment fetch failed for course ${course.id} (status ${enrollRes.status})`
        );
        // If we can’t fetch enrollment, skip this course
        continue;
      }
      const enrollArr = await enrollRes.json();
      const me = enrollArr.find((e) => e.type === 'StudentEnrollment');

      // Prepare the “course‐level” data:
      const currentGrade = me?.grades?.current_grade ?? null;   // e.g. “A-”
      const currentScore = me?.grades?.current_score ?? null;   // e.g. 90.94

      // --- Fetch assignments + your submission for this course:
      const assignmentsRes = await fetch(
        `https://providencepsd.instructure.com/api/v1/courses/${course.id}/assignments?` +
          `include[]=submission&student_ids[]=self`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      let assignmentsList = [];
      if (assignmentsRes.ok) {
        const assignmentsJson = await assignmentsRes.json(); // array of assignment objects
        // Build a lighter array:
        assignmentsList = assignmentsJson.map((a) => {
          return {
            name: a.name,
            score: a.submission?.score ?? null,
            possible: a.points_possible ?? null,
            status: a.submission?.workflow_state ?? 'not_submitted',
          };
        });
      } else {
        console.warn(
          `Assignments fetch failed for course ${course.id} (status ${assignmentsRes.status})`
        );
      }

      // 4️⃣ Push the combined object into “results”
      results.push({
        course: course.name,
        current_grade: currentGrade,
        current_score: currentScore,
        assignments: assignmentsList,
      });
    }

    // 5️⃣ Return that combined array
    return res.json(results);
  } catch (err) {
    console.error('Proxy Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = serverless(app);
