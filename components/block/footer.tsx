import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type FooterLinkItem = { label: string; href: string; isExternal?: boolean };
export type FooterColumn = { title: string; links: FooterLinkItem[] };

export type FooterProps = {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  columns?: FooterColumn[];
  /** Oversized fading word along the bottom edge. */
  wordmark?: string;
  bottom?: ReactNode;
  className?: string;
};

export function Footer({ eyebrow, title, description, columns = [], wordmark, bottom, className }: FooterProps) {
  return (
    <footer className={cn("relative flex w-full flex-col overflow-hidden border-t border-border/60 px-5 pt-16", className)}>
      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col justify-between gap-12 pb-16 lg:flex-row">
        <div className="flex max-w-md flex-col">
          {eyebrow && (
            <div className="mb-6">
              <span className="inline-block rounded-full bg-muted px-3 py-1 text-[10px] font-medium tracking-[0.2em] text-muted-foreground uppercase">
                {eyebrow}
              </span>
            </div>
          )}
          <h2 className="text-2xl leading-tight font-semibold tracking-tight text-balance md:text-3xl">{title}</h2>
          {description && <div className="mt-4 text-sm leading-relaxed text-muted-foreground text-pretty">{description}</div>}
        </div>

        {columns.length > 0 && (
          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 lg:gap-16">
            {columns.map((column) => (
              <div key={column.title} className="flex flex-col gap-4">
                <h3 className="text-[11px] font-medium tracking-[0.2em] text-muted-foreground uppercase">{column.title}</h3>
                <ul className="flex flex-col gap-2.5">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <a
                        href={link.href}
                        {...(link.isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                        className="block text-sm text-foreground/80 transition-colors duration-150 hover:text-foreground"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {wordmark && (
        <div aria-hidden className="pointer-events-none flex select-none justify-center overflow-hidden">
          <span className="bg-linear-to-b from-foreground/25 via-foreground/10 to-transparent bg-clip-text text-[16vw] leading-[0.8] font-semibold tracking-tighter whitespace-nowrap text-transparent lg:text-[11rem]">
            {wordmark}
          </span>
        </div>
      )}

      {bottom && <div className="relative z-10 mx-auto w-full max-w-5xl py-6 text-xs text-muted-foreground tabular-nums">{bottom}</div>}
    </footer>
  );
}

export default Footer;
