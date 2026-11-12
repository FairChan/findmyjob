import http from 'k6/http'
import { check } from 'k6'
import { Counter } from 'k6/metrics'
const completed = new Counter('transport_completed')
export const options = { vus: 1, iterations: 1, thresholds: { checks: ['rate==1'], transport_completed: ['count==1'] } }
export default async function probe() {
  await new Promise(resolve => setTimeout(resolve, 10))
  const response = await http.asyncRequest('GET', `${__ENV.LOAD_COORDINATOR}/${__ENV.LOAD_RUN_ID}/probe`, null, { timeout: '10s' })
  if (check(response, { 'container reaches this owned loopback coordinator': r => r.status === 200 && r.json('runId') === __ENV.LOAD_RUN_ID })) completed.add(1)
}
