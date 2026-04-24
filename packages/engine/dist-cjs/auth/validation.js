"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.signupSchema = exports.loginSchema = void 0;
exports.getPasswordStrength = getPasswordStrength;
const zod_1 = require("zod");
// Password strength checker
function getPasswordStrength(password) {
    let score = 0;
    if (password.length >= 8)
        score++;
    if (password.length >= 12)
        score++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password))
        score++;
    if (/\d/.test(password))
        score++;
    if (/[!@#$%^&*(),.?":{}|<>]/.test(password))
        score++;
    if (score <= 1)
        return { score, label: "Слабый", color: "bg-red-500" };
    if (score <= 2)
        return { score, label: "Средний", color: "bg-yellow-500" };
    if (score <= 3)
        return { score, label: "Хороший", color: "bg-blue-500" };
    return { score, label: "Надёжный", color: "bg-green-500" };
}
// Login schema
exports.loginSchema = zod_1.z.object({
    email: zod_1.z
        .string()
        .min(1, "Email обязателен")
        .email("Неверный формат email"),
    password: zod_1.z
        .string()
        .min(1, "Пароль обязателен")
        .min(6, "Пароль должен быть не менее 6 символов"),
    rememberMe: zod_1.z.boolean().default(false),
});
// Signup schema
exports.signupSchema = zod_1.z
    .object({
    name: zod_1.z
        .string()
        .min(1, "Имя обязательно")
        .min(2, "Имя должно быть не менее 2 символов")
        .max(50, "Имя не должно превышать 50 символов"),
    email: zod_1.z
        .string()
        .min(1, "Email обязателен")
        .email("Неверный формат email"),
    password: zod_1.z
        .string()
        .min(1, "Пароль обязателен")
        .min(8, "Пароль должен быть не менее 8 символов")
        .regex(/[a-zA-Z]/, "Пароль должен содержать буквы")
        .regex(/\d/, "Пароль должен содержать цифры"),
    confirmPassword: zod_1.z
        .string()
        .min(1, "Подтверждение пароля обязательно"),
    terms: zod_1.z
        .boolean()
        .refine((val) => val === true, {
        message: "Необходимо принять условия использования",
    }),
})
    .refine((data) => data.password === data.confirmPassword, {
    message: "Пароли не совпадают",
    path: ["confirmPassword"],
});
