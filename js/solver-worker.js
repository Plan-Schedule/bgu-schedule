// Runs the schedule search off the main thread, so a phone stays responsive on big course lists.
import { searchSchedules } from './model.js';

self.onmessage = (e) => {
  const { job, courses, state } = e.data;
  try {
    self.postMessage({ job, raw: searchSchedules(courses, state) });
  } catch (err) {
    self.postMessage({ job, error: String(err?.message || err) });
  }
};
