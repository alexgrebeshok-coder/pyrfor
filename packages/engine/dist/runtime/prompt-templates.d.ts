/**
 * Prompt Template Engine — Jinja-lite subset for LLM prompt construction.
 *
 * Syntax:
 *   {{ var }}                — interpolation; dotted paths supported (user.name)
 *   {{ var | filter }}       — filters: upper | lower | trim | json | length | default(v)
 *   {% if cond %} … {% elif cond %} … {% else %} … {% endif %}
 *   {% for item in list %} … {% endfor %}  — loop.index0 / loop.index1 available
 *   {% include 'name' %}     — partial lookup in registry
 *   {# comment #}            — stripped at compile time
 *   {%- … -%}               — whitespace-stripping variants
 *
 * Design: pure recursive-descent parser → explicit AST → tree-walking interpreter.
 * No eval, no Function constructor.
 */
export type TemplateContext = Record<string, any>;
export declare class TemplateError extends Error {
    readonly line: number;
    readonly col: number;
    constructor(message: string, line: number, col: number);
}
export interface PromptTemplateEngine {
    registerPartial(name: string, source: string): void;
    removePartial(name: string): void;
    listPartials(): string[];
    render(source: string, ctx: TemplateContext): string;
    renderTemplate(name: string, ctx: TemplateContext): string;
    clearCache(): void;
    registerFilter(name: string, fn: (val: any, ...args: any[]) => any): void;
}
export declare function createPromptTemplateEngine(opts?: {
    cacheSize?: number;
    logger?: (msg: string, meta?: any) => void;
}): PromptTemplateEngine;
//# sourceMappingURL=prompt-templates.d.ts.map