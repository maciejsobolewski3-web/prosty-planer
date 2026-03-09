/**
 * Detail Page Utility
 *
 * Shared utility for rendering detail page forms that replace modals.
 * Supports dynamic field layout, validation, action binding, and data collection.
 */

import { esc, showFieldError } from './ui';

// ─────────────────────────────────────────────────────────────────
// Types & Interfaces
// ─────────────────────────────────────────────────────────────────

export type DPFieldType =
  | 'text'
  | 'number'
  | 'email'
  | 'tel'
  | 'date'
  | 'textarea'
  | 'select'
  | 'color'
  | 'datalist'
  | 'custom';

/**
 * Represents a single form field in a detail page.
 */
export interface DPField {
  id: string; // HTML element id, e.g. "f-c-name"
  name: string; // field key for dpCollect, e.g. "name"
  label: string;
  type: DPFieldType;
  value?: string | number;
  placeholder?: string;
  required?: boolean;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  options?: Array<{ value: string; label: string }>; // for select/datalist
  datalistId?: string; // for datalist type
  hint?: string;
  validation?: (val: string) => string | null; // returns error message or null
  readonly?: boolean;
  rows?: number; // for textarea
  span?: 1 | 2 | 3; // how many grid columns to span (default 1)
  customHtml?: string; // for type='custom', raw HTML to render instead of input
}

/**
 * Represents a section containing multiple fields with optional grouping.
 */
export interface DPSection {
  id: string;
  title: string;
  subtitle?: string;
  columns?: 1 | 2 | 3; // grid columns (default 2)
  fields: DPField[];
  collapsible?: boolean;
  customHtml?: string; // appended after fields (for links editor, price chart, etc.)
}

/**
 * Represents a footer action button.
 */
export interface DPFooterButton {
  id: string;
  label: string;
  icon?: string; // FontAwesome class, e.g. "fa-solid fa-check"
  style: 'primary' | 'secondary' | 'danger' | 'ghost';
  action: string; // data-action value
}

/**
 * Result of form validation.
 */
export interface DPValidationResult {
  valid: boolean;
  errors: Record<string, string>; // field id → error message
  firstInvalidId?: string;
}

// ─────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────

/**
 * Renders the detail page header with title and optional back button.
 */
export function dpHeader(title: string, backAction?: string): string {
  const back = `
    <button class="dp-back-btn" data-action="${backAction || 'back'}" title="Wróć">
      <i class="fa-solid fa-arrow-left"></i>
      <span>Wróć</span>
    </button>
  `;
  return `
    <div class="dp-header">
      ${back}
      <h1 class="dp-header-title">${esc(title)}</h1>
      <div style="width: 60px;"></div>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────
// Field Rendering (Internal)
// ─────────────────────────────────────────────────────────────────

/**
 * Renders a single form field. For internal use by dpSections.
 */
function renderField(field: DPField): string {
  const fieldId = field.id;
  const fieldClass = 'field';
  let input = '';

  if (field.type === 'custom') {
    // Custom HTML: wrap in div with appropriate span
    const span = field.span ? ` style="grid-column: span ${field.span}"` : '';
    return `<div${span}>${field.customHtml || ''}</div>`;
  }

  const valAttr = field.value !== undefined && field.type !== 'select'
    ? `value="${field.type === 'number' ? field.value : esc(String(field.value))}"`
    : '';
  const baseAttrs = [
    `id="${fieldId}"`,
    valAttr,
    field.placeholder ? `placeholder="${esc(field.placeholder)}"` : '',
    field.required ? 'required' : '',
    field.readonly ? 'readonly' : '',
  ].filter(Boolean).join(' ');

  if (field.type === 'select') {
    const opts = field.options || [];
    const valStr = field.value !== undefined ? String(field.value) : '';
    const optionsHtml = opts
      .map(
        (opt) =>
          `<option value="${esc(opt.value)}"${opt.value === valStr ? ' selected' : ''}>${esc(opt.label)}</option>`
      )
      .join('');
    input = `<select id="${fieldId}" ${field.required ? 'required' : ''} ${field.readonly ? 'disabled' : ''}>${optionsHtml}</select>`;
  } else if (field.type === 'datalist') {
    const datalistId = field.datalistId || `dl-${fieldId}`;
    const opts = field.options || [];
    const optionsHtml = opts.map((opt) => `<option value="${esc(opt.value)}">${esc(opt.label)}</option>`).join('');
    const datalistEl = `<datalist id="${datalistId}">${optionsHtml}</datalist>`;
    input = `<input type="text" list="${datalistId}" ${baseAttrs} />${datalistEl}`;
  } else if (field.type === 'textarea') {
    const rows = field.rows || 3;
    input = `<textarea id="${fieldId}" rows="${rows}" ${field.placeholder ? `placeholder="${esc(field.placeholder)}"` : ''} ${field.required ? 'required' : ''} ${field.readonly ? 'readonly' : ''}>${field.value !== undefined ? esc(String(field.value)) : ''}</textarea>`;
  } else if (field.type === 'color') {
    input = `<input type="color" ${baseAttrs} style="height: 38px; padding: 4px; cursor: pointer;" />`;
  } else {
    // text, number, email, tel, date, etc.
    const attrs = baseAttrs
      + (field.min !== undefined ? ` min="${field.min}"` : '')
      + (field.max !== undefined ? ` max="${field.max}"` : '')
      + (field.step !== undefined ? ` step="${field.step}"` : '');
    input = `<input type="${field.type}" ${attrs} />`;
  }

  const label = `<label for="${fieldId}">${esc(field.label)}</label>`;
  const hint = field.hint ? `<div class="field-hint">${esc(field.hint)}</div>` : '';
  const span = field.span ? ` style="grid-column: span ${field.span}"` : '';

  return `
    <div class="${fieldClass}"${span}>
      ${label}
      ${input}
      ${hint}
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────
// Sections
// ─────────────────────────────────────────────────────────────────

/**
 * Renders all sections with their fields in a grid layout.
 */
export function dpSections(sections: DPSection[]): string {
  const sectionHtml = sections
    .map((section) => {
      const cols = section.columns || 2;
      const gridClass = cols === 1 ? 'dp-field-grid-1' : cols === 3 ? 'dp-field-grid-3' : 'dp-field-grid-2';
      const fieldsHtml = section.fields.map((f) => renderField(f)).join('');
      const customHtml = section.customHtml || '';

      return `
        <div class="dp-section" id="${section.id}">
          <div class="dp-section-title">${esc(section.title)}</div>
          ${section.subtitle ? `<div class="dp-section-subtitle">${esc(section.subtitle)}</div>` : ''}
          <div class="dp-field-grid ${gridClass}">
            ${fieldsHtml}
          </div>
          ${customHtml}
        </div>
      `;
    })
    .join('');

  return `<div class="dp-body">${sectionHtml}</div>`;
}

// ─────────────────────────────────────────────────────────────────
// Footer & Actions
// ─────────────────────────────────────────────────────────────────

/**
 * Renders the footer with action buttons.
 */
export function dpFooter(buttons: DPFooterButton[]): string {
  const buttonsHtml = buttons
    .map((btn) => {
      const btnClass =
        btn.style === 'primary'
          ? 'btn btn-primary'
          : btn.style === 'danger'
            ? 'btn btn-danger'
            : btn.style === 'ghost'
              ? 'btn btn-ghost'
              : 'btn';
      const icon = btn.icon ? `<i class="${btn.icon}"></i>` : '';
      return `
        <button id="${btn.id}" class="${btnClass}" data-action="${btn.action}" title="${esc(btn.label)}">
          ${icon}
          <span>${esc(btn.label)}</span>
        </button>
      `;
    })
    .join('');

  return `<div class="dp-footer">${buttonsHtml}</div>`;
}

/**
 * Binds click and keyboard event handlers to the detail page container.
 * Supports data-action attributes on buttons and keyboard shortcuts.
 */
export function dpBindActions(
  container: HTMLElement,
  handlers: Record<string, (e: Event) => void>
): void {
  // Click handler using event delegation
  container.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement;
    if (!btn) return;
    const action = btn.dataset.action!;
    if (handlers[action]) {
      handlers[action](e);
    }
  });

  // Keyboard handlers
  container.addEventListener('keydown', (e: KeyboardEvent) => {
    // Escape key → 'back' handler
    if (e.key === 'Escape') {
      if (handlers['back']) {
        handlers['back'](e);
      }
      return;
    }

    // Enter key → 'save' handler (unless in textarea)
    if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
      if (handlers['save']) {
        handlers['save'](e);
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────────
// Data Collection & Validation
// ─────────────────────────────────────────────────────────────────

/**
 * Collects form data from all fields in all sections.
 * Returns an object keyed by field.name with values from the DOM.
 */
export function dpCollect(
  container: HTMLElement,
  sections: DPSection[]
): Record<string, any> {
  const data: Record<string, any> = {};

  sections.forEach((section) => {
    section.fields.forEach((field) => {
      // Skip custom fields (no value collection)
      if (field.type === 'custom') return;

      const el = container.querySelector<HTMLElement>('#' + field.id);
      if (!el) return;

      let value: any;

      if (field.type === 'number') {
        const inputEl = el as HTMLInputElement;
        value = parseFloat(inputEl.value) || 0;
      } else if (field.type === 'select') {
        const selectEl = el as HTMLSelectElement;
        value = selectEl.value;
      } else if (field.type === 'textarea') {
        const textareaEl = el as HTMLTextAreaElement;
        value = textareaEl.value.trim();
      } else if (field.type === 'color') {
        const inputEl = el as HTMLInputElement;
        value = inputEl.value;
      } else if (field.type === 'datalist') {
        const inputEl = el as HTMLInputElement;
        value = inputEl.value.trim();
      } else {
        // text, email, tel, date, etc.
        const inputEl = el as HTMLInputElement;
        value = inputEl.value.trim();
      }

      data[field.name] = value;
    });
  });

  return data;
}

/**
 * Validates all fields in all sections.
 * Displays errors inline and returns validation result.
 */
export function dpValidate(
  container: HTMLElement,
  sections: DPSection[]
): DPValidationResult {
  const errors: Record<string, string> = {};
  let firstInvalidId: string | undefined;

  sections.forEach((section) => {
    section.fields.forEach((field) => {
      // Skip custom fields
      if (field.type === 'custom') return;

      const el = container.querySelector<HTMLElement>('#' + field.id);
      if (!el) return;

      const input = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      const value = input.value.trim();
      let errorMsg: string | null = null;

      // Required validation
      if (field.required && !value) {
        errorMsg = 'Pole wymagane';
      }

      // Custom validation
      if (!errorMsg && field.validation && value) {
        errorMsg = field.validation(value);
      }

      // Display error
      if (errorMsg) {
        errors[field.id] = errorMsg;
        showFieldError(input, errorMsg);
        if (!firstInvalidId) {
          firstInvalidId = field.id;
        }
      } else {
        showFieldError(input, null);
      }
    });
  });

  // Focus first invalid field after a short delay
  if (firstInvalidId) {
    setTimeout(() => {
      const el = container.querySelector<HTMLElement>('#' + firstInvalidId);
      if (el) (el as HTMLInputElement).focus();
    }, 50);
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    firstInvalidId,
  };
}

/**
 * Focuses the first non-readonly, non-custom field in the detail page.
 */
export function dpFocus(container: HTMLElement, sections: DPSection[]): void {
  for (const section of sections) {
    for (const field of section.fields) {
      if (field.type === 'custom' || field.readonly) continue;
      const el = container.querySelector<HTMLElement>('#' + field.id);
      if (el) {
        setTimeout(() => {
          (el as HTMLInputElement).focus();
        }, 50);
        return;
      }
    }
  }
}
