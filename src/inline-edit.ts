export interface InlineEditConfig {
  type?: 'text' | 'number';  // default 'text'
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;           // e.g. " zł" — displayed after value but not in input
  onSave: (newValue: string | number) => void;
  onCancel?: () => void;
  selectAll?: boolean;       // select text on focus (default true)
}

/**
 * InlineEditFieldConfig is like InlineEditConfig but with onSave optional.
 * Used for the typeMap parameter in bindInlineEdits, since the main onSave is provided by bindInlineEdits itself.
 */
export interface InlineEditFieldConfig {
  type?: 'text' | 'number';  // default 'text'
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;           // e.g. " zł" — displayed after value but not in input
  onSave?: (newValue: string | number) => void;
  onCancel?: () => void;
  selectAll?: boolean;       // select text on focus (default true)
}

/**
 * Makes a table cell (or any element) editable on click.
 * Click → replaces content with input → Enter/blur saves → Escape reverts.
 * 
 * Usage:
 *   const cell = document.querySelector('td.price');
 *   makeEditable(cell, {
 *     type: 'number',
 *     step: 0.01,
 *     onSave: (val) => { updatePrice(id, val); render(); }
 *   });
 */
export function makeEditable(cell: HTMLElement, config: InlineEditConfig): void {
  // Skip if already editing (cell has .inline-editing class)
  if (cell.classList.contains('inline-editing')) return;
  
  const originalText = cell.textContent?.trim() ?? '';
  // Parse original value — strip suffix, "zł", spaces, replace comma with dot for numbers
  let originalValue = originalText;
  if (config.suffix) {
    originalValue = originalValue.replace(config.suffix, '');
  }
  originalValue = originalValue.replace(/\s*zł\s*/, '').replace(',', '.').trim();
  
  const type = config.type || 'text';
  
  // Create input
  const input = document.createElement('input');
  input.type = type;
  input.value = originalValue;
  input.className = 'inline-edit-input';
  if (type === 'number') {
    if (config.step !== undefined) input.step = String(config.step);
    if (config.min !== undefined) input.min = String(config.min);
    if (config.max !== undefined) input.max = String(config.max);
  }
  
  // Mark cell as editing
  cell.classList.add('inline-editing');
  const originalHTML = cell.innerHTML;
  cell.innerHTML = '';
  cell.appendChild(input);
  
  // Focus and select
  input.focus();
  if (config.selectAll !== false) {
    input.select();
  }
  
  let saved = false;
  
  const save = () => {
    if (saved) return;
    saved = true;
    cell.classList.remove('inline-editing');
    
    const rawValue = input.value.trim();
    const newValue = type === 'number' ? (parseFloat(rawValue) || 0) : rawValue;
    
    // Only call onSave if value actually changed
    if (String(newValue) !== originalValue) {
      config.onSave(newValue);
    } else {
      // Revert to original HTML
      cell.innerHTML = originalHTML;
    }
  };
  
  const cancel = () => {
    if (saved) return;
    saved = true;
    cell.classList.remove('inline-editing');
    cell.innerHTML = originalHTML;
    config.onCancel?.();
  };
  
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    } else if (e.key === 'Tab') {
      save();
      // Let tab propagate naturally
    }
  });
  
  input.addEventListener('blur', () => {
    // Small delay to allow keydown handlers to fire first
    setTimeout(() => {
      if (!saved) save();
    }, 50);
  });
}

/**
 * Binds inline editing to all elements matching a selector within a container.
 * Elements should have data-inline-field and data-inline-id attributes.
 * 
 * Usage:
 *   bindInlineEdits(page, '[data-editable]', (id, field, value) => {
 *     updateMaterial(id, { [field]: value });
 *     render();
 *   });
 */
export function bindInlineEdits(
  container: HTMLElement,
  selector: string,
  onSave: (id: number, field: string, value: string | number) => void,
  typeMap?: Record<string, InlineEditFieldConfig>
): void {
  container.querySelectorAll<HTMLElement>(selector).forEach((cell) => {
    cell.style.cursor = 'pointer';
    cell.title = 'Kliknij aby edytować';
    cell.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(cell.dataset.inlineId!);
      const field = cell.dataset.inlineField!;
      const fieldConfig = typeMap?.[field] || {};
      
      makeEditable(cell, {
        ...fieldConfig,
        onSave: (newValue) => onSave(id, field, newValue),
      } as InlineEditConfig);
    });
  });
}
