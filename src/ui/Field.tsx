import { type InputHTMLAttributes, type TextareaHTMLAttributes, forwardRef } from "react";
import styles from "./Field.module.css";

const join = (...parts: Array<string | undefined>): string => parts.filter(Boolean).join(" ");

/** A single-line text or number field on the app's input surface. */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={join(styles.field, className)} {...rest} />;
  },
);

/** A multi-line field; grows vertically only. */
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={join(styles.field, styles.area, className)} {...rest} />;
});
