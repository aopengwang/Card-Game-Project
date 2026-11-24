import * as T from "@radix-ui/react-tooltip";
import type { ReactElement, ReactNode } from "react";
import s from "./Tip.module.css";

/** Wrap the app once so tooltips share timing (hovering from one to the next is instant). */
export function TipProvider({ children }: { children: ReactNode }) {
  return (
    <T.Provider delayDuration={300} skipDelayDuration={200}>
      {children}
    </T.Provider>
  );
}

/** A rules tooltip. `children` must be a single DOM element (it becomes the trigger). */
export function Tip({ content, children, side = "top" }: { content: ReactNode; children: ReactElement; side?: "top" | "bottom" | "left" | "right" }) {
  if (content == null || content === false) return children;
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} collisionPadding={10} className={s.tip}>
          {content}
          <T.Arrow className={s.arrow} width={12} height={6} />
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

/** Standard tooltip body: a title line, optional tags, rules text. */
export function TipBody({ title, tags, text }: { title: ReactNode; tags?: string[]; text?: ReactNode }) {
  return (
    <div className={s.body}>
      <div className={s.head}>
        <span className={s.title}>{title}</span>
        {tags?.map((t) => (
          <span key={t} className={s.tag}>
            {t}
          </span>
        ))}
      </div>
      {text && <div className={s.text}>{text}</div>}
    </div>
  );
}
