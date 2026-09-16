/** Subagent - run background consultations with a stronger, read-only model. */

import { spawn, type ChildProcess } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const SUBAGENT_MODEL = "openrouter/openai/gpt-6-astra";
const SUBAGENT_THINKING = "max";
const SUBAGENT_TIMEOUT_MS = 10 * 60 * 1000;
const KILL_GRACE_MS = 5000;
const SUBAGENT_CONTRACT =
  "You are a read-only senior expert consulted by another agent that cannot see your work. " +
  "Investigate the relevant files before answering, lead with your recommendation, cite concrete evidence, " +
  "and state uncertainty. Do not ask questions and do not modify files.";

type JobStatus = "running" | "done" | "failed" | "killed";
type KillIntent = "user" | "timeout";

interface Job {
  id: number;
  question: string;
  status: JobStatus;
  exitCode: number | null;
  startedAt: number;
  child: ChildProcess;
  stdout: string;
  stderr: string;
  intent: KillIntent | null;
  timeout: ReturnType<typeof setTimeout> | null;
  delivered: boolean;
}

/** Build the child pi argv for one consultation. */
function buildArgs(question: string): string[] {
  return [
    "-p",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--tools", "read,grep,find,ls",
    "--model", SUBAGENT_MODEL,
    "--thinking", SUBAGENT_THINKING,
    "--append-system-prompt", SUBAGENT_CONTRACT,
    question,
  ];
}

/** Build the follow-up message text for a finished job. */
function completionText(job: Job): string {
  if (job.status === "done") {
    return `Subagent #${job.id} finished.\n\n${job.stdout.trim()}`;
  }
  if (job.status === "killed") {
    const reason = job.intent === "timeout" ? ` after the ${SUBAGENT_TIMEOUT_MS / 60000}-minute timeout` : "";
    return `Subagent #${job.id} was killed${reason}. No answer.`;
  }
  const detail = job.stderr.trim() || job.stdout.trim() || "no output";
  return `Subagent #${job.id} failed (exit code ${job.exitCode ?? "unknown"}).\n\n${detail.slice(-2000)}`;
}

export default function (pi: ExtensionAPI) {
  const jobs = new Map<number, Job>();
  let nextId = 0;

  /** Send the one follow-up message a finished job is allowed. */
  function deliver(job: Job): void {
    if (job.delivered) return;
    job.delivered = true;
    pi.sendMessage(
      { customType: "subagent", content: completionText(job), display: true },
      { deliverAs: "followUp", triggerTurn: true },
    );
  }

  /** Record a job's terminal state and deliver its result. */
  function finish(job: Job, status: JobStatus, exitCode: number | null): void {
    if (job.timeout) clearTimeout(job.timeout);
    job.status = status;
    job.exitCode = exitCode;
    deliver(job);
  }

  /** Ask a running job's process to stop. */
  function kill(job: Job, intent: KillIntent): void {
    if (job.status !== "running") return;
    job.intent = intent;
    job.child.kill("SIGTERM");
    setTimeout(() => {
      if (job.status === "running") job.child.kill("SIGKILL");
    }, KILL_GRACE_MS).unref();
  }

  /** Start a background consultation and return its job immediately. */
  function start(question: string, cwd: string): Job {
    const id = ++nextId;
    const child = spawn("pi", buildArgs(question), { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const job: Job = {
      id,
      question,
      status: "running",
      exitCode: null,
      startedAt: Date.now(),
      child,
      stdout: "",
      stderr: "",
      intent: null,
      timeout: null,
      delivered: false,
    };
    jobs.set(id, job);

    child.stdout?.on("data", (chunk: Buffer) => {
      job.stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      job.stderr += chunk.toString("utf8");
    });
    child.on("error", (error: Error) => {
      job.stderr += error.message;
      if (job.status === "running") finish(job, "failed", null);
    });
    child.on("close", (code: number | null) => {
      if (job.status !== "running") return;
      if (job.intent) finish(job, "killed", code);
      else if (code === 0 && job.stdout.trim()) finish(job, "done", code);
      else finish(job, "failed", code);
    });

    job.timeout = setTimeout(() => kill(job, "timeout"), SUBAGENT_TIMEOUT_MS);
    job.timeout.unref();
    return job;
  }

  /** Render the job list for the user. */
  function listText(): string {
    if (jobs.size === 0) return "No subagent jobs.";
    return Array.from(jobs.values())
      .map((job) => {
        const age = Math.round((Date.now() - job.startedAt) / 1000);
        const preview = job.question.length > 60 ? `${job.question.slice(0, 60)}...` : job.question;
        return `#${job.id} ${job.status} ${age}s - ${preview}`;
      })
      .join("\n");
  }

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Start a background consultation with a stronger, read-only model. Returns immediately with a job id; " +
      "the answer arrives later as a follow-up message. Do not wait, poll, or repeat the question. " +
      "Use it for high intelligence analysis at crucial stages only!",
    parameters: Type.Object({
      question: Type.String({ description: "Complete, self-contained question for the subagent." }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const job = start(params.question, ctx.cwd);
      return {
        content: [{ type: "text", text: `Subagent #${job.id} started. The answer will arrive as a follow-up message.` }],
        details: {},
      };
    },
  });

  pi.registerCommand("subagent", {
    description: "Run a background subagent consultation",
    handler: async (args, ctx) => {
      const question = args.trim();
      if (!question) {
        ctx.ui.notify("Usage: /subagent <question>", "warning");
        return;
      }
      const job = start(question, ctx.cwd);
      ctx.ui.notify(`Subagent #${job.id} started.`, "info");
    },
  });

  pi.registerCommand("subagents", {
    description: "List subagent jobs",
    handler: async (_args, ctx) => {
      ctx.ui.notify(listText(), "info");
    },
  });

  pi.registerCommand("subagent-kill", {
    description: "Kill a running subagent job",
    handler: async (args, ctx) => {
      const target = args.trim();
      if (!target) {
        ctx.ui.notify(`${listText()}\n\nUsage: /subagent-kill <id|all>`, "info");
        return;
      }
      if (target === "all") {
        let count = 0;
        for (const job of jobs.values()) {
          if (job.status !== "running") continue;
          kill(job, "user");
          count++;
        }
        ctx.ui.notify(`Killed ${count} subagent job(s).`, "info");
        return;
      }
      const job = jobs.get(Number(target));
      if (!job || job.status !== "running") {
        ctx.ui.notify(`No running subagent job #${target}.`, "warning");
        return;
      }
      kill(job, "user");
      ctx.ui.notify(`Killed subagent #${job.id}.`, "info");
    },
  });

  pi.on("session_shutdown", async () => {
    for (const job of jobs.values()) {
      if (job.status !== "running") continue;
      if (job.timeout) clearTimeout(job.timeout);
      job.status = "killed";
      job.child.kill("SIGKILL");
    }
  });
}
