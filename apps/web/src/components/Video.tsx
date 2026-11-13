import { Snail } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { t } from "@vgt/core";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A looping sign video with a slow-motion control. Videos have no sound. */
export function SignVideo({
  src,
  poster,
  autoPlay = true,
  loop = true,
  controls = false,
  className,
  label,
}: {
  src: string;
  poster?: string | null;
  autoPlay?: boolean;
  loop?: boolean;
  controls?: boolean;
  className?: string;
  label?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (ref.current) ref.current.playbackRate = slow ? 0.5 : 1;
  }, [slow, src]);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <video
        ref={ref}
        key={src}
        src={src}
        poster={poster ?? undefined}
        autoPlay={autoPlay}
        loop={loop}
        muted
        playsInline
        controls={controls}
        preload="auto"
        aria-label={label}
        className="aspect-[4/3] max-h-[45dvh] w-full rounded-lg bg-black object-contain"
        onLoadedData={(e) => {
          e.currentTarget.playbackRate = slow ? 0.5 : 1;
        }}
      />
      {!controls && (
        <div className="flex justify-center gap-2">
          <Button variant="ghost" size="sm" aria-pressed={slow} onClick={() => setSlow((s) => !s)}>
            <Snail aria-hidden /> {slow ? t.practice.normalSpeed : t.practice.slow}
          </Button>
        </div>
      )}
    </div>
  );
}
