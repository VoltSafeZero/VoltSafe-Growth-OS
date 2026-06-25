import http from "k6/http";
import { sleep, check } from "k6";
import { Rate } from "k6/metrics";

const errorRate = new Rate("errors");

export const options = {
  stages: [
    { duration: "60s", target: 100 },
    { duration: "3m",  target: 100 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    errors: ["rate<0.05"],
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<2000"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";
const SESSION_COOKIE = __ENV.SESSION_COOKIE || "";

const HEADERS = {
  Cookie: SESSION_COOKIE,
  "Content-Type": "application/json",
};

const ENDPOINTS = [
  "/api/leads?page=1&limit=20",
  "/api/accounts?page=1&limit=20",
  "/api/contacts?page=1&limit=20",
  "/api/opportunities?page=1&limit=20",
  "/api/metrics",
  "/api/tasks?page=1&limit=20",
  "/api/gmail/messages?limit=20",
  "/health",
];

export default function () {
  const url = ENDPOINTS[Math.floor(Math.random() * ENDPOINTS.length)];
  const res = http.get(`${BASE_URL}${url}`, { headers: HEADERS });

  const ok = check(res, {
    "not a 500": (r) => r.status < 500,
    "responded": (r) => r.status > 0,
  });
  errorRate.add(!ok);

  sleep(0.5 + Math.random());
}
