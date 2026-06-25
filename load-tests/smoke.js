import http from "k6/http";
import { sleep, check } from "k6";
import { Rate } from "k6/metrics";

const errorRate = new Rate("errors");

export const options = {
  stages: [
    { duration: "30s", target: 5 },
    { duration: "1m", target: 5 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    errors: ["rate<0.01"],
    http_req_duration: ["p(95)<800"],
    http_req_failed: ["rate<0.01"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";
const SESSION_COOKIE = __ENV.SESSION_COOKIE || "";

const HEADERS = {
  Cookie: SESSION_COOKIE,
  "Content-Type": "application/json",
};

export default function () {
  const endpoints = [
    "/api/leads?page=1&limit=20",
    "/api/accounts?page=1&limit=20",
    "/api/contacts?page=1&limit=20",
    "/health",
  ];

  const url = endpoints[Math.floor(Math.random() * endpoints.length)];
  const res = http.get(`${BASE_URL}${url}`, { headers: HEADERS });

  const ok = check(res, {
    "status is 200 or 401": (r) => r.status === 200 || r.status === 401,
    "response time < 800ms": (r) => r.timings.duration < 800,
  });

  errorRate.add(!ok);
  sleep(1 + Math.random());
}
