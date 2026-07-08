"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

/**
 * Lifecycle states surfaced to the UI. The `queued → lyrics → audio → cover →
 * completed` flow mirrors the 5-step timeline rendered in `RealtimeLoader`.
 * `error` is terminal; `idle` / `connecting` are pre-progress states local to
 * the hook (never sent by the server).
 */
export type JobStatus =
  | "queued"
  | "lyrics"
  | "audio"
  | "cover"
  | "completed"
  | "error";

export type HookStatus = JobStatus | "idle" | "connecting";

/**
 * Wire format published to the Redis `job:{jobId}` channel and relayed by the
 * socket server as the `progress` event. Every field is optional on the wire;
 * the hook only applies the fields that are present.
 */
export interface JobProgressPayload {
  status?: JobStatus;
  /** 0–100. May be monotonic, may regress if the publisher chooses. */
  progress?: number;
  error?: string | null;
  songId?: string | null;
  /** Optional human-readable stage label, overrides the default copy. */
  stage?: string;
}

export interface UseJobSocketResult {
  status: HookStatus;
  progress: number;
  error: string | null;
  songId: string | null;
  connected: boolean;
}

interface JobState {
  /** JobId this state belongs to — used to detect stale state across resets. */
  jobId: string | null;
  /** Last status reported by the server, or null before any progress event. */
  serverStatus: JobStatus | null;
  progress: number;
  error: string | null;
  songId: string | null;
  connected: boolean;
}

const INITIAL_STATE: JobState = {
  jobId: null,
  serverStatus: null,
  progress: 0,
  error: null,
  songId: null,
  connected: false,
};

/**
 * Subscribe to real-time generation progress for a single job.
 *
 * Connects to the SpotiBot socket.io mini-service (port 3001) via the Caddy
 * gateway: `io("/?XTransformPort=3001", { query: { jobId } })`. The gateway
 * inspects the `XTransformPort` query param and reverse-proxies the request to
 * the matching local port — see `Caddyfile`.
 *
 * State model:
 *  - All `setState` calls live inside socket event callbacks (never in the
 *    effect body), so the hook complies with `react-hooks/set-state-in-effect`.
 *  - When `jobId` changes, state is reset using the React-endorsed "adjust
 *    state during render" pattern
 *    (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes):
 *    a setState call guarded by a `state.jobId !== jobId` check, which fires
 *    once per prop change and re-renders immediately before the effect runs.
 *  - The exposed `status` is DERIVED: `idle` when jobId is null,
 *    `connecting` before the first progress event arrives (or `queued` once
 *    the socket is live but no progress has yet been received), and the
 *    server-reported status otherwise.
 *
 * On unmount (or when `jobId` changes), the socket is fully disconnected and
 * listeners are torn down.
 */
export function useJobSocket(jobId: string | null): UseJobSocketResult {
  const [state, setState] = useState<JobState>(INITIAL_STATE);
  const socketRef = useRef<Socket | null>(null);

  // Reset state when jobId changes. setState-during-render is the React-
  // recommended pattern for "adjusting state when a prop changes" — React
  // discards the in-progress render and re-renders immediately with the new
  // state, without committing the intermediate render or hitting the effect.
  if (state.jobId !== jobId) {
    setState({ ...INITIAL_STATE, jobId });
  }

  useEffect(() => {
    if (!jobId) {
      // No socket to manage — defensive cleanup only.
      socketRef.current?.disconnect();
      socketRef.current = null;
      return;
    }

    const socket = io("/?XTransformPort=3001", {
      transports: ["websocket", "polling"],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
      query: { jobId },
    });
    socketRef.current = socket;

    const isCurrent = (s: JobState): boolean => s.jobId === jobId;

    const onConnect = () => {
      setState((s) =>
        isCurrent(s)
          ? {
              ...s,
              connected: true,
              // Surface "queued" as soon as the socket is live IF no progress
              // event has arrived yet — otherwise let the server status win.
              serverStatus: s.serverStatus ?? "queued",
            }
          : s,
      );
    };
    const onDisconnect = () => {
      setState((s) => (isCurrent(s) ? { ...s, connected: false } : s));
    };
    const onConnectError = (err: Error) => {
      setState((s) =>
        isCurrent(s)
          ? { ...s, error: err?.message ?? "Connection error" }
          : s,
      );
    };
    const onProgress = (data: JobProgressPayload) => {
      if (!data || typeof data !== "object") return;
      setState((s) => {
        if (!isCurrent(s)) return s;
        return {
          ...s,
          serverStatus:
            typeof data.status === "string" ? data.status : s.serverStatus,
          progress:
            typeof data.progress === "number"
              ? Math.max(0, Math.min(100, data.progress))
              : s.progress,
          error:
            typeof data.error === "string"
              ? data.error
              : data.error === null
                ? null
                : s.error,
          songId:
            typeof data.songId === "string"
              ? data.songId
              : data.songId === null
                ? null
                : s.songId,
        };
      });
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("progress", onProgress);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("progress", onProgress);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [jobId]);

  // Derive the public status: idle → connecting → queued → server status.
  const status: HookStatus =
    jobId === null
      ? "idle"
      : state.serverStatus === null
        ? state.connected
          ? "queued"
          : "connecting"
        : state.serverStatus;

  return {
    status,
    progress: state.progress,
    error: state.error,
    songId: state.songId,
    connected: state.connected,
  };
}

export default useJobSocket;
