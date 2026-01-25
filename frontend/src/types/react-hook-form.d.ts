declare module "react-hook-form" {
  // Minimal, local typings to unblock TS; align with v7 API surface we use.
  export type FieldValues = Record<string, any>;
  export type FieldPath<TFieldValues extends FieldValues = FieldValues> = string & keyof TFieldValues;

  export type ControllerProps<
    TFieldValues extends FieldValues = FieldValues,
    TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
  > = {
    name: TName;
    control: any;
    rules?: any;
    render: (params: { field: any; fieldState: any; formState: any }) => React.ReactElement;
  };

  export const Controller: <TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>(
    props: ControllerProps<TFieldValues, TName>,
  ) => React.ReactElement;

  export type UseFormReturn<TFieldValues extends FieldValues = FieldValues> = {
    control: any;
    handleSubmit: any;
    register: any;
    watch: any;
    formState: any;
    reset: any;
    setValue: any;
    getFieldState: (name: string, formState?: any) => any;
  };

  export function useForm<TFieldValues extends FieldValues = FieldValues>(opts?: any): UseFormReturn<TFieldValues>;
  export function useFormContext<TFieldValues extends FieldValues = FieldValues>(): UseFormReturn<TFieldValues>;
  export function useFormState(args: any): any;
  export function useController(args: any): any;
  export function useFieldArray(args: any): any;
  export function useWatch(args: any): any;
  export const FormProvider: any;
}
