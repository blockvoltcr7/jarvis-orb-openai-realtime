"use client";

import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", children, ...rest }, ref) => {
    const base =
      "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium tracking-wide transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:opacity-50 disabled:cursor-not-allowed";
    const styles: Record<Variant, string> = {
      primary:
        "bg-cyan-400/10 text-cyan-100 btn-glow hover:bg-cyan-400/20 hover:text-white",
      ghost:
        "bg-white/5 text-cyan-100/80 hover:bg-white/10 border border-white/10",
      danger:
        "bg-red-500/15 text-red-200 hover:bg-red-500/25 border border-red-400/30",
    };
    return (
      <button ref={ref} className={cn(base, styles[variant], className)} {...rest}>
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
