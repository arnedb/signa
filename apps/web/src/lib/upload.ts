import type { Schemas } from "@signa/api-client";
import { useQuery } from "@tanstack/react-query";

import { ApiError, api, unwrap } from "@/lib/api";

/** Upload a file with progress (fetch has no upload progress), using the session cookie. */
export function uploadFile<T>(
  url: string,
  file: File,
  fields: Record<string, string> = {},
  onProgress?: (fraction: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file);
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    xhr.open("POST", url);
    xhr.withCredentials = true;
    xhr.setRequestHeader("X-Signa-Client", "web");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else {
        const detail = (body as { detail?: unknown } | null)?.detail;
        reject(new ApiError(xhr.status, typeof detail === "string" ? detail : xhr.statusText));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "Netwerkfout"));
    xhr.send(form);
  });
}

export type Job = Schemas["JobOut"];

export function isRunning(status: string | undefined): boolean {
  return status === "queued" || status === "running";
}

/** Poll a background job until it is done or failed. */
export function useJob(id: number | null) {
  return useQuery({
    queryKey: ["admin", "job", id],
    queryFn: () => unwrap(api.GET("/api/v1/admin/jobs/{job_id}", { params: { path: { job_id: id ?? 0 } } })),
    enabled: id != null,
    refetchInterval: (q) => (isRunning(q.state.data?.status) || !q.state.data ? 1000 : false),
  });
}
