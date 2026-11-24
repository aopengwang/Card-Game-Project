import * as D from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import s from "./Modal.module.css";

interface Props {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  /** false: Esc and clicking outside do nothing (e.g. a choice the game is waiting for). */
  dismissible?: boolean;
  onClose?: () => void;
  wide?: boolean;
  className?: string;
  children: ReactNode;
}

/** Accessible modal (focus trapped, labelled) in the Ink & Lacquer style. */
export function Modal({ open, title, description, dismissible = true, onClose, wide, className, children }: Props) {
  const block = (e: Event) => {
    if (!dismissible) e.preventDefault();
  };
  return (
    <D.Root open={open} onOpenChange={(next) => !next && dismissible && onClose?.()}>
      <D.Portal>
        {/* Content inside the overlay: the overlay scrolls on small screens. */}
        <D.Overlay className={`${s.overlay} overlay`}>
          <D.Content
            className={`${s.modal} ${wide ? s.wide : ""} ${className ?? ""}`}
            onEscapeKeyDown={block}
            onPointerDownOutside={block}
            onInteractOutside={block}
            {...(description ? {} : { "aria-describedby": undefined })}
          >
            <D.Title className={s.title}>{title}</D.Title>
            {description && <D.Description className={s.description}>{description}</D.Description>}
            {children}
          </D.Content>
        </D.Overlay>
      </D.Portal>
    </D.Root>
  );
}
