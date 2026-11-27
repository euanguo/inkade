import type {
  AgentBriefingJobRecord,
  AgentBriefingRunRecord,
  BriefingJobId,
  BriefingPresetTemplate,
  BriefingRunId,
  BriefingRunStatus,
  CreateBriefingJobInput,
  RunBriefingJobInput,
  UpdateBriefingJobInput,
} from "@inkade/core";
import { buildQuery, type InkadeHttpTransport } from "../http-transport.ts";

export interface ListBriefingJobsResponse {
  readonly jobs: readonly AgentBriefingJobRecord[];
  readonly presets: readonly BriefingPresetTemplate[];
}

export interface ListBriefingRunsParams {
  readonly jobId?: BriefingJobId | undefined;
  readonly status?: BriefingRunStatus | undefined;
  readonly undismissedOnly?: boolean | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

export interface BriefingsResource {
  listJobs(): Promise<ListBriefingJobsResponse>;
  getJob(jobId: BriefingJobId): Promise<AgentBriefingJobRecord>;
  createJob(input: CreateBriefingJobInput): Promise<AgentBriefingJobRecord>;
  updateJob(jobId: BriefingJobId, input: UpdateBriefingJobInput): Promise<AgentBriefingJobRecord>;
  deleteJob(jobId: BriefingJobId): Promise<{ readonly deleted: true; readonly id: BriefingJobId }>;
  runJobNow(jobId: BriefingJobId, input?: RunBriefingJobInput): Promise<AgentBriefingRunRecord>;
  listRuns(params?: ListBriefingRunsParams): Promise<readonly AgentBriefingRunRecord[]>;
  dismissRun(runId: BriefingRunId): Promise<AgentBriefingRunRecord>;
}

export function createBriefingsResource(transport: InkadeHttpTransport): BriefingsResource {
  return {
    listJobs() {
      return transport.requestJson<ListBriefingJobsResponse>("/api/v1/briefings/jobs");
    },

    async getJob(jobId) {
      const res = await transport.requestJson<{ readonly job: AgentBriefingJobRecord }>(
        `/api/v1/briefings/jobs/${encodeURIComponent(jobId)}`,
      );
      return res.job;
    },

    async createJob(input) {
      const res = await transport.requestJson<{ readonly job: AgentBriefingJobRecord }>(
        "/api/v1/briefings/jobs",
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
      return res.job;
    },

    async updateJob(jobId, input) {
      const res = await transport.requestJson<{ readonly job: AgentBriefingJobRecord }>(
        `/api/v1/briefings/jobs/${encodeURIComponent(jobId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(input),
        },
      );
      return res.job;
    },

    deleteJob(jobId) {
      return transport.requestJson<{ readonly deleted: true; readonly id: BriefingJobId }>(
        `/api/v1/briefings/jobs/${encodeURIComponent(jobId)}`,
        { method: "DELETE" },
      );
    },

    async runJobNow(jobId, input) {
      const res = await transport.requestJson<{ readonly run: AgentBriefingRunRecord }>(
        `/api/v1/briefings/jobs/${encodeURIComponent(jobId)}/run`,
        {
          method: "POST",
          ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
        },
      );
      return res.run;
    },

    listRuns(params = {}) {
      const qs = buildQuery({
        jobId: params.jobId,
        status: params.status,
        undismissedOnly:
          params.undismissedOnly !== undefined
            ? String(params.undismissedOnly)
            : undefined,
        limit: params.limit,
        offset: params.offset,
      });
      return transport
        .requestJson<{ readonly runs: readonly AgentBriefingRunRecord[] }>(
          `/api/v1/briefings/runs${qs}`,
        )
        .then((res) => res.runs);
    },

    async dismissRun(runId) {
      const res = await transport.requestJson<{ readonly run: AgentBriefingRunRecord }>(
        `/api/v1/briefings/runs/${encodeURIComponent(runId)}/dismiss`,
        { method: "POST" },
      );
      return res.run;
    },
  };
}
