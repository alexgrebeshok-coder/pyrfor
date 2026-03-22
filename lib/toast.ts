import { toast } from "sonner";

/**
 * Toast notification helpers for CEOClaw Dashboard
 * Uses Sonner for toast notifications
 */

// ============================================
// Basic Toast Functions
// ============================================

export const showToast = {
  success: (message: string) => toast.success(message),
  error: (message: string) => toast.error(message),
  info: (message: string) => toast.info(message),
  warning: (message: string) => toast.warning(message),
  
  /**
   * Show a toast with a promise - automatically shows loading/success/error states
   */
  promise: <T,>(
    promise: Promise<T>,
    messages: {
      loading: string;
      success: string;
      error: string;
    }
  ) => toast.promise(promise, messages),
  
  /**
   * Show a custom toast with optional action button
   */
  custom: (message: string, options?: { 
    action?: { label: string; onClick: () => void };
    duration?: number;
  }) => toast(message, options),
  
  /**
   * Dismiss all toasts
   */
  dismiss: () => toast.dismiss(),
};

// ============================================
// Predefined Toast Actions
// ============================================

export const toastActions = {
  // Task actions
  taskCreated: () => showToast.success("Задача создана"),
  taskUpdated: () => showToast.success("Задача обновлена"),
  taskDeleted: () => showToast.success("Задача удалена"),
  taskCompleted: () => showToast.success("Задача завершена"),
  tasksBulkUpdated: (count: number) => showToast.success(`Обновлено задач: ${count}`),
  
  // Project actions
  projectSaved: () => showToast.success("Проект сохранён"),
  projectCreated: () => showToast.success("Проект создан"),
  projectUpdated: () => showToast.success("Проект обновлён"),
  projectDeleted: () => showToast.success("Проект удалён"),
  projectDuplicated: () => showToast.success("Проект дублирован"),
  
  // Team actions
  teamMemberAdded: () => showToast.success("Участник добавлен"),
  teamMemberUpdated: () => showToast.success("Участник обновлён"),
  teamMemberRemoved: () => showToast.success("Участник удалён"),
  
  // Settings actions
  settingsSaved: () => showToast.success("Настройки сохранены"),
  preferencesUpdated: () => showToast.success("Предпочтения обновлены"),
  
  // File actions
  fileUploaded: () => showToast.success("Файл загружен"),
  fileExported: () => showToast.success("Экспорт завершён"),
  
  // Auth actions
  loginSuccess: () => showToast.success("Вход выполнен"),
  logoutSuccess: () => showToast.success("Выход выполнен"),
  
  // Error actions
  error: (message?: string) => showToast.error(message || "Произошла ошибка"),
  networkError: () => showToast.error("Ошибка сети. Проверьте подключение"),
  validationError: (field?: string) => showToast.error(field 
    ? `Ошибка валидации: ${field}` 
    : "Проверьте введённые данные"
  ),
  notFound: () => showToast.error("Объект не найден"),
  unauthorized: () => showToast.error("Требуется авторизация"),
  forbidden: () => showToast.error("Доступ запрещён"),
  serverError: () => showToast.error("Ошибка сервера. Попробуйте позже"),
  
  // Warning actions
  unsavedChanges: () => showToast.warning("Есть несохранённые изменения"),
  sessionExpiring: () => showToast.warning("Сессия скоро истечёт"),
  
  // Info actions
  copied: () => showToast.info("Скопировано в буфер обмена"),
  loading: (message?: string) => showToast.info(message || "Загрузка..."),
};

// ============================================
// Async Action Wrapper
// ============================================

/**
 * Wraps an async action with automatic loading/success/error toasts
 */
export async function withToast<T>(
  action: () => Promise<T>,
  messages: {
    loading?: string;
    success: string;
    error?: string;
  }
): Promise<T | null> {
  try {
    const result = await showToast.promise(action(), {
      loading: messages.loading || "Выполняется...",
      success: messages.success,
      error: messages.error || "Произошла ошибка",
    }) as T;
    return result;
  } catch {
    return null;
  }
}

// ============================================
// Export default
// ============================================

export default showToast;
