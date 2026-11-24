import type { ButtonHTMLAttributes, ReactNode } from "react";
import s from "./Button.module.css";

type Variant = "primary" | "secondary" | "ghost";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  shape?: "default" | "pill" | "small";
  /** Keyboard key that presses this button (KeyboardEvent.key; letters lower case). */
  shortcut?: string;
}

const KEY_LABEL: Record<string, string> = { Enter: "↵", Escape: "Esc" };
const ARIA_KEY: Record<string, string> = { Enter: "Enter", Escape: "Escape" };

export function Button({ variant = "secondary", shape = "default", className, type = "button", shortcut, children, ...rest }: Props) {
  const cls = [s.btn, variant !== "secondary" ? s[variant] : "", shape !== "default" ? s[shape] : "", className ?? ""].join(" ");
  if (!shortcut) return <button type={type} className={cls} {...rest}>{children}</button>;
  return (
    <button
      type={type}
      className={cls}
      data-shortcut={shortcut}
      aria-keyshortcuts={ARIA_KEY[shortcut] ?? shortcut.toUpperCase()}
      {...rest}
    >
      {children}
      {/* hidden from screen readers: aria-keyshortcuts announces it, and the name stays "Use" */}
      <kbd className={s.kbd} aria-hidden="true">
        {KEY_LABEL[shortcut] ?? shortcut.toUpperCase()}
      </kbd>
    </button>
  );
}

/** A skill (or conversion) button: brush character in a vermilion seal + the name. */
export function SealButton({
  char,
  label,
  active,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { char: string; label: ReactNode; active?: boolean }) {
  return (
    <button type="button" className={`${s.btn} ${s.sealBtn} ${active ? s.active : ""} ${className ?? ""}`} aria-pressed={active} {...rest}>
      <span className={s.sealChar} lang="zh-CN" aria-hidden="true">
        {char}
      </span>
      <span>{label}</span>
    </button>
  );
}
