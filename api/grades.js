// api/grades.js

export default async function handler(req, res) {
  // ─── CORS: Always include these headers ────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', 'https://ilyambr.me');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // ─── Handle preflight OPTIONS ─────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    // Returning 200 with the CORS headers above satisfies the preflight
    return res.status(200).end();
  }

  // ─── Only allow POST for the actual grades request ────────────────────
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // ─── Parse JSON body ───────────────────────────────────────────────────
  let body;
  try {
    body = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => (data += chunk));
      req.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });
  } catch (err) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const token = body.token;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Missing token' });
  }

  // ─── Fetch Canvas Courses & Grades ────────────────────────────────────
  try {
    // 1) Get list of courses
    const courseRes = await fetch(
      'https://providencepsd.instructure.com/api/v1/courses',
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    if (!courseRes.ok) {
      throw new Error(`Canvas returned ${courseRes.status} when fetching courses`);
    }
    const courses = await courseRes.json();

    // 2) For each course, fetch enrollment & grades
    const results = [];
    for (const course of courses) {
      const enrollRes = await fetch(
        `https://providencepsd.instructure.com/api/v1/courses/${course.id}/enrollments`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      if (!enrollRes.ok) {
        // skip if Canvas won’t return enrollment for this course
        continue;
      }
      const enrollments = await enrollRes.json();
      const student = enrollments.find(e => e.type === 'StudentEnrollment');
      if (student && student.grades) {
        results.push({
          course: course.name,
          grade: student.grades.current_grade || 'N/A',
          score: student.grades.current_score || 'N/A'
        });
      }
    }

    // 3) Return the JSON array of { course, grade, score }
    return res.status(200).json(results);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
