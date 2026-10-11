/** USD. 0 or unset turns that alert off. */
export interface CostAlertThresholds {
  daily?: number
  session?: number
}

/** A Settings › Alerts threshold that was just passed. Costs are estimates. */
export type CostAlert =
  | { kind: 'daily'; day: string; cost: number; threshold: number }
  | {
      kind: 'session'
      sessionId: string
      projectId: string
      title: string
      cost: number
      threshold: number
    }

/** What `push:cost-alert` carries: the alert and the text it was shown with. */
export type CostAlertNotice = CostAlert & { message: { title: string; body: string } }
