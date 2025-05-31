// File: api/grades.js
const express = require('express');
const fetch = require('node-fetch'); // or global fetch if Node v18+
const cors = require('cors');
const serverless = require('serverless-http');

const app = express();

// ONLY allow your domain to call this proxy:
app.use(
  cors({
    origin: 'https://ilyambr.me',
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  })
);
app.options('/api/grades', cors()); // handle preflight

app.use(express.json());

app.post('/api/grades', async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'Missing token' });
  }

  try {
    // 1) Fetch all courses you’re enrolled in
    const coursesRes = await fetch(
      'https://providencepsd.instructure.com/api/v1/courses',
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (!coursesRes.ok) {
      throw new Error(
        `Failed to fetch courses (status ${coursesRes.status})`
      );
    }
    const courses = await coursesRes.json(); // array of { id, name, … }

    const results = [];

    for (const course of courses) {
      // 2a) Fetch your StudentEnrollment (with grades) for this course
      const enrollRes = await fetch(
        `https://providencepsd.instructure.com/api/v1/courses/${course.id}/enrollments?type[]=StudentEnrollment&include[]=grades`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (!enrollRes.ok) {
        console.warn(
          `Enrollment fetch failed for course ${course.id} (status ${enrollRes.status})`
        );
        continue; // skip this course if enrollment fails
      }
      const enrollArr = await enrollRes.json();
      const me = enrollArr.find((e) => e.type === 'StudentEnrollment');

      // Grab overall course‐level grade & score (may be null)
      const currentGrade = me?.grades?.current_grade ?? null;
      const currentScore = me?.grades?.current_score ?? null;

      // 2b) Fetch all of *your* submissions in this course
      //     This returns one submission object per assignment you are enrolled in.
      //     Each submission object has .assignment_id, .score, .grade, .workflow_state, etc.
      const subRes = await fetch(
        `https://providencepsd.instructure.com/api/v1/courses/${course.id}/students/submissions?student_ids[]=self`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (!subRes.ok) {
        console.warn(
          `Submissions fetch failed for course ${course.id} (status ${subRes.status})`
        );
        // We’ll treat “no submissions” as an empty list
      }
      const submissions = subRes.ok ? await subRes.json() : [];

      // 3) We need the assignment *names*, but the /students/submissions route only returns assignment_id.
      //    So gather all assignment IDs, then fetch them in one multi‐id call:
      //    Canvas supports fetching multiple assignments by ID in a single request:
      //      GET /api/v1/courses/:course_id/assignments?access_only[IDs]=12345,67890,…
      //    However, Canvas’s “multi‐id” filter differs by account; if that doesn’t work, fallback is to fetch each assignment one by one.
      //
      //    We'll attempt the “?assignment_ids[]=...” style. If it fails, we do one by one.

      const assignmentIDs = submissions
        .map((s) => s.assignment_id)
        .filter(Boolean);

      let assignmentObjects = [];
      if (assignmentIDs.length > 0) {
        // Build a query string like ?assignment_ids[]=123&assignment_ids[]=456
        const qs = assignmentIDs
          .map((id) => `assignment_ids[]=${id}`)
          .join('&');

        const assignFetch = await fetch(
          `https://providencepsd.instructure.com/api/v1/courses/${course.id}/assignments?${qs}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        if (assignFetch.ok) {
          assignmentObjects = await assignFetch.json(); // array of assignments
        } else {
          // fallback: one-by-one
          assignmentObjects = [];
          for (const aID of assignmentIDs) {
            const singleA = await fetch(
              `https://providencepsd.instructure.com/api/v1/courses/${course.id}/assignments/${aID}`,
              {
                headers: { Authorization: `Bearer ${token}` },
              }
            );
            if (singleA.ok) {
              assignmentObjects.push(await singleA.json());
            }
          }
        }
      }

      // Turn assignmentObjects into a lookup by assignment_id → { name, points_possible, ... }
      const assignLookup = {};
      assignmentObjects.forEach((a) => {
        assignLookup[a.id] = {
          name: a.name,
          possible: a.points_possible,
        };
      });

      // 4) Now combine submissions + assignment info into a compact array
      const assignmentsList = submissions.map((s) => {
        const info = assignLookup[s.assignment_id] || {
          name: 'Unknown Assignment',
          possible: null,
        };
        return {
          name: info.name,
          score: s.score, // numeric points earned (or null if not graded)
          possible: info.possible,
          status: s.workflow_state, // e.g. "graded", "missing", "late", etc.
        };
      });

      // 5) Push the result for this course
      results.push({
        course: course.name,
        current_grade: currentGrade,
        current_score: currentScore,
        assignments: assignmentsList,
      });
    }

    // 6) Return the combined array
    return res.json(results);
  } catch (err) {
    console.error('Proxy Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = serverless(app);
