"use client";

import React, { createContext, useContext, useId } from "react";
import {
  Controller,
  type ControllerProps,
  type FieldError as RhfFieldError,
  type FieldPath,
  type FieldValues,
  FormProvider,
  useFormContext,
  useFormState,
} from "react-hook-form";
import { cn } from "../lib/utils.ts";

export const Form = FormProvider;

interface FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> {
  readonly name: TName;
}

const FormFieldContext = createContext<FormFieldContextValue | null>(null);

interface FormItemContextValue {
  readonly id: string;
}

const FormItemContext = createContext<FormItemContextValue | null>(null);

export function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({ ...props }: ControllerProps<TFieldValues, TName>): React.ReactElement {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
}

export function useFormField(): {
  readonly id: string;
  readonly name: string;
  readonly formItemId: string;
  readonly formDescriptionId: string;
  readonly formMessageId: string;
  readonly invalid: boolean;
  readonly isDirty: boolean;
  readonly isTouched: boolean;
  readonly isValidating: boolean;
  readonly error?: RhfFieldError | undefined;
} {
  const fieldContext = useContext(FormFieldContext);
  const itemContext = useContext(FormItemContext);
  const { getFieldState } = useFormContext();
  const formState = useFormState(fieldContext ? { name: fieldContext.name } : {});

  if (!fieldContext) {
    throw new Error("useFormField must be used within <FormField>");
  }

  const fieldState = getFieldState(fieldContext.name, formState);
  const id = itemContext?.id ?? fieldContext.name;

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  };
}

export function FormItem({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  const id = useId();
  return (
    <FormItemContext.Provider value={{ id }}>
      <div
        className={cn("flex flex-col gap-1.5", className)}
        data-slot="form-item"
        {...props}
      />
    </FormItemContext.Provider>
  );
}

export function FormLabel({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>): React.ReactElement {
  const { error, formItemId } = useFormField();
  return (
    <label
      className={cn(
        "inline-flex items-center gap-2 font-medium text-sm/5 text-foreground data-[error=true]:text-destructive-foreground",
        className,
      )}
      data-error={Boolean(error)}
      data-slot="form-label"
      htmlFor={formItemId}
      {...props}
    />
  );
}

export function FormControl({
  children,
}: {
  readonly children: React.ReactElement<Record<string, unknown>>;
}): React.ReactElement {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField();
  const existingDescribedBy =
    typeof children.props["aria-describedby"] === "string"
      ? children.props["aria-describedby"]
      : undefined;
  const describedBy = error
    ? [existingDescribedBy, formDescriptionId, formMessageId].filter(Boolean).join(" ")
    : [existingDescribedBy, formDescriptionId].filter(Boolean).join(" ") || undefined;

  return React.cloneElement(children, {
    id: children.props["id"] ?? formItemId,
    "aria-invalid": Boolean(error),
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
  });
}

export function FormDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>): React.ReactElement {
  const { formDescriptionId } = useFormField();
  return (
    <p
      className={cn("text-xs text-muted-foreground", className)}
      data-slot="form-description"
      id={formDescriptionId}
      {...props}
    />
  );
}

export function FormMessage({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>): React.ReactElement | null {
  const { error, formMessageId } = useFormField();
  const body = error ? String(error.message ?? "") : children;
  if (!body) return null;
  return (
    <p
      className={cn("text-xs font-medium text-destructive-foreground", className)}
      data-slot="form-message"
      id={formMessageId}
      role="alert"
      {...props}
    >
      {body}
    </p>
  );
}
