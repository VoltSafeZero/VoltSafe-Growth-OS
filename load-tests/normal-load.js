import http from "k6/http";
import { sleep, check, group } from "k6";
import { Rate, Trend } from "k6/metrics";

const errorRate = new Rate("errors");
const crmLatency = new Trend("crm_latency");
const dashboardLatency = new Trend("dashboard_latency");

export const options = {
  stages: [
    { duration: "2m", target: 25 },
    { duration: "8m", target: 25 },
    { duration: "1m", target: 0 },
  ],
  thresholds: {
    errors: ["rate<0.01"],
    http_req_failed: ["rate<0.01"],
    crm_latency: ["p(95)<800"],
    dashboard_latency: ["p(95)<1500"],
    http_req_duration: ["p(95)<1000"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";
const SESSION_COOKIE = __ENV.SESSION_COOKIE || "";

const HEADERS = {
  Cookie: SESSION_COOKIE,
  "Content-Type": "application/json",
};

const CRM_ENDPOINTS = [
  "/api/leads?page=1&limit=20",
  "/api/leads?page=2&limit=20",
  "/api/accounts?page=1&limit=20",
  "/api/contacts?page=1&limit=20",
  "/api/opportunities?page=1&limit=20",
  "/api/tickets?page=1&limit=20",
];

const DASHBOARD_ENDPOINTS = [
  "/api/metrics",
  "/api/activities?limit=20",
  "/api/tasks?page=1&limit=20",
];

const MAIL_ENDPOINTS = [
  "/api/gmail/messages?limit=20",
  "/api/email-accounts",
];

export default function () {
  const roll = Math.random();

  if (roll < 0.5) {
    group("CRM browsing", () => {
      const url = CRM_ENDPOINTS[Math.floor(Math.random() * CRM_ENDPOINTS.length)];
      const res = http.get(`${BASE_URL}${url}`, { headers: HEADERS });
      crmLatency.add(res.timings.duration);
      const ok = check(res, {
        "status ok": (r) => r.status === 200 || r.status === 401,
        "crm p95 < 800ms": (r) => r.timings.duration < 800,
      });
      errorRate.add(!ok);
    });
  } else if (roll < 0.75) {
    group("Dashboard", () => {
      const url = DASHBOARD_ENDPOINTS[Math.floor(Math.random() * DASHBOARD_ENDPOINTS.length)];
      const res = http.get(`${BASE_URL}${url}`, { headers: HEADERS });
      dashboardLatency.add(res.timings.duration);
      const ok = check(res, {
        "status ok": (r) => r.status === 200 || r.status === 401,
        "dashboard p95 < 1500ms": (r) => r.timings.duration < 1500,
      });
      errorRate.add(!ok);
    });
  } else {
    group("Mail inbox", () => {
      const url = MAIL_ENDPOINTS[Math.floor(Math.random() * MAIL_ENDPOINTS.length)];
      const res = http.get(`${BASE_URL}${url}`, { headers: HEADERS });
      const ok = check(res, {
        "status ok": (r) => r.status === 200 || r.status === 401,
      });
      errorRate.add(!ok);
    });
  }

  sleep(1 + Math.random() * 2);
}
