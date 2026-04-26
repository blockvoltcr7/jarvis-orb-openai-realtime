import { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "glass rounded-2xl p-4 shadow-[0_0_40px_rgba(34,211,238,0.05)]",
        className
      )}
      {...rest}
    />
  );
}
