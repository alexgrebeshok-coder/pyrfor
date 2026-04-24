import { z } from "zod";
declare function getPasswordStrength(password: string): {
    score: number;
    label: string;
    color: string;
};
export declare const loginSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
    rememberMe: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export type LoginFormData = z.infer<typeof loginSchema>;
export declare const signupSchema: z.ZodObject<{
    name: z.ZodString;
    email: z.ZodString;
    password: z.ZodString;
    confirmPassword: z.ZodString;
    terms: z.ZodBoolean;
}, z.core.$strip>;
export type SignupFormData = z.infer<typeof signupSchema>;
export { getPasswordStrength };
//# sourceMappingURL=validation.d.ts.map