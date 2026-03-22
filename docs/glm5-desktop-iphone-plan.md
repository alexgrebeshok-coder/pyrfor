# CEOClaw: план создания desktop-приложения и iPhone-приложения

## Контекст

Текущий продуктовый источник правды - это Next.js App Router приложение в `ceoclaw-dev`.
Сейчас уже есть:

- live-first web app;
- Tauri v2 baseline для desktop;
- PWA-first mobile shell;
- рабочие API, календарь, Gantt, задачи, проекты, риски, analytics и search;
- подтверждённые build/test/e2e проходы для основного web-потока.

Главная цель этого плана - довести CEOClaw до состояния, когда:

- desktop-приложение можно собрать и отдать как нормальный macOS bundle;
- iPhone-приложение можно установить и запустить как отдельный мобильный клиент;
- данные везде отражаются из одного источника правды;
- UI/UX выглядит как законченный продукт, а не как web demo;
- никаких production mock/demo fallback-ов в пользовательском контракте не остаётся.

## Ключевое решение по архитектуре

### Desktop

Используем Tauri v2 как thin desktop shell вокруг live production web app.

Причина:

- минимальный риск;
- не надо дублировать UI;
- можно сохранить текущий Next.js backend/API;
- уже есть существующий `src-tauri/` baseline.

### iPhone

Используем iOS native shell поверх текущего web app, предпочтительно через Capacitor-style WebView wrapper.

Причина:

- самый быстрый путь к iPhone app без переписывания продукта на React Native;
- re-use текущего Next.js UI и API;
- можно сохранить единый кодовый источник;
- лучше всего подходит к текущей архитектуре, где web app уже живёт как продуктовая основа.

Если на этапе реализации выяснится, что pure WebView wrapper недостаточен для App Store policy или UX, тогда fallback-путь - точечно добавлять native iOS capabilities, но не переписывать весь продукт.

## Что уже есть в репо

- `src-tauri/tauri.conf.json` - desktop baseline.
- `scripts/build-desktop-shell.mjs` - сборка thin shell.
- `docs/desktop-setup.md` - текущая desktop схема.
- `public/manifest.json`, `public/sw.js`, `components/pwa-install-prompt.tsx` - PWA-first mobile слой.
- `app/layout.tsx`, `components/layout/*` - общий shell/UI.

## Что нужно сделать

### Поток A. Desktop-приложение

#### A1. Завершить desktop runtime contract

Нужно убедиться, что desktop shell:

- открывает live production URL, а не локальную заглушку;
- корректно стартует в dev и build режимах;
- имеет понятный loading state;
- не требует ручных обходных действий при запуске.

Конкретные задачи:

- проверить и при необходимости доработать `scripts/build-desktop-shell.mjs`;
- убедиться, что `NEXT_PUBLIC_APP_URL` обязателен и валидируется;
- проверить, что Tauri dev/build используют согласованные URL;
- добавить/докрутить fallback state для недоступной сети;
- убедиться, что deep link / external browser handoff не ломает навигацию;
- проверить, что auth session сохраняется в webview;
- проверить upload/download flows в desktop shell.

#### A2. Desktop UX polish

Нужно довести desktop shell до состояния "продукт выглядит как native client":

- нормальный стартовый экран;
- адекватные размеры окна;
- нативные ощущения от навигации;
- горячие клавиши;
- отсутствие mobile-only артефактов в desktop layout;
- предсказуемое поведение modals, dropdowns, context actions.

Конкретные точки:

- `components/layout/app-shell.tsx`
- `components/layout/sidebar.tsx`
- `components/layout/topbar.tsx`
- `app/layout.tsx`
- `components/pwa-*` не должны мешать desktop UX

#### A3. Desktop packaging

Нужно получить реальный distributable artifact:

- macOS app bundle;
- DMG или другой приемлемый дистрибутив;
- корректные icon assets;
- понятный versioning;
- bundle identifier;
- signing/notarization path хотя бы как documented release flow.

Проверить:

- `npm run tauri:build`
- что артефакт создаётся на clean environment;
- что bundle открывается без ручной правки файлов;
- что брендирование и title совпадают с CEOClaw.

#### A4. Desktop docs

Обновить/дополнить:

- `docs/desktop-setup.md`
- `README.md`
- при необходимости новый `docs/desktop-release.md`

Документация должна объяснять:

- как запускать dev;
- как собрать release;
- какие env нужны;
- как работает live-web wrapper;
- какие ограничения есть у desktop shell.

### Поток B. iPhone-приложение

#### B1. Создать iOS shell

Нужно добавить новый iOS package/project, который:

- открывает production HTTPS web app;
- использует отдельный iOS bundle identifier;
- поддерживает iPhone screen sizes и safe areas;
- работает как standalone app на устройстве и в simulator.

Рекомендуемая стартовая модель:

- Capacitor-like wrapper;
- remote URL в production;
- local dev URL в simulator;
- единая auth/session модель с web app.

Если выбирать конкретно, GLM5 должен сделать так, чтобы:

- dev запускался против локального Next dev server;
- production сборка ссылалась на HTTPS production URL;
- app icon, splash, status bar и safe area выглядели как нативный iPhone client.

#### B2. iPhone UX adaptation

Web app должен быть удобен на iPhone без отдельной переписки всего UI.

Нужно проверить и при необходимости доработать:

- layout ширины 390-430 px;
- большие tap targets;
- отсутствие hover-only UI;
- sticky bottom actions там, где это полезно;
- читабельность таблиц, карточек и форм;
- calendar/task/project screens;
- command/search flows;
- onboarding/login/register flows;
- project detail и task detail для touch usage.

В первую очередь проверить:

- `app/layout.tsx`
- `components/layout/app-shell.tsx`
- `components/layout/sidebar.tsx`
- `components/layout/topbar.tsx`
- `components/projects/*`
- `components/tasks/*`
- `components/calendar/*`
- `components/analytics/*`
- `app/search/page.tsx`

#### B3. iPhone app capabilities

Нужно решить минимум для первого релиза:

- login/session persistence;
- navigation back behavior;
- file upload/download;
- safe area / status bar;
- offline or degraded state;
- pull-to-refresh или аналог при необходимости;
- app icon / splash / bundle metadata.

Если времени хватит, можно добавить:

- share sheet;
- deep links;
- push notifications;
- haptic feedback для primary actions.

#### B4. iPhone packaging

Нужно получить:

- Xcode project / archive-ready build;
- simulator smoke;
- device smoke;
- описание release path;
- список required permissions / entitlements;
- App Store prep checklist, если это целевой формат.

### Поток C. Общий UI/UX polish

Это общий слой для desktop, iPhone и web.

#### C1. Единая продуктовая консистентность

Проверить, что данные отражаются одинаково в:

- projects;
- project detail;
- tasks;
- calendar;
- gantt;
- analytics;
- search;
- risks;
- settings.

Нужно убедиться, что:

- create/update/delete flows синхронны;
- no stale UI after refresh;
- client cache не противоречит API;
- server snapshot не расходится с dashboard state.

#### C2. Empty/loading/error states

Доделать и проверить:

- empty state для пустых списков;
- loading skeletons;
- понятные error states;
- retry actions;
- no dead-end screens.

#### C3. Mobile-first and desktop-first polish

Нужно проверить:

- spacing and typography;
- card density;
- navigation hierarchy;
- keyboard shortcuts on desktop;
- touch ergonomics on iPhone;
- responsive charts and tables;
- no clipped content at small widths.

## Рекомендуемый порядок работ

### Этап 1. Desktop finish

1. Зафиксировать desktop runtime contract.
2. Довести `tauri:build` до стабильного, воспроизводимого результата.
3. Добавить signing/notarization docs.
4. Проверить desktop smoke на реальном macOS app bundle.

### Этап 2. iPhone shell

1. Создать iOS wrapper проект.
2. Подключить remote production URL и local dev URL.
3. Проверить auth/session/navigation.
4. Довести mobile UI до iPhone-safe layout.

### Этап 3. Shared polish

1. Убрать все user-visible rough edges.
2. Проверить reflection across spaces.
3. Проверить command/search/calendar/project/task/analytics consistency.

### Этап 4. Release verification

1. Build green.
2. Unit tests green.
3. E2E reflection flow green.
4. Desktop artifact exists and launches.
5. iPhone simulator/device launch works.

## Критерии готовности

### Desktop готов, если:

- `npm run tauri:build` стабильно проходит;
- `npm run tauri:dev` открывает рабочий CEOClaw client;
- desktop app выглядит как полноценный product shell;
- session/auth и data flows работают;
- артефакт можно передать на staging/release flow.

### iPhone готов, если:

- iPhone app запускается в simulator и на device;
- login работает;
- основные flows не ломаются на touch UI;
- project/task/calendar/search работают;
- нет критичных layout breaks;
- app можно упаковать в archive/build для дальнейшего release процесса.

### Общий продукт готов, если:

- project/task/risk/milestone/document data отражаются в нужных пространствах;
- calendar и gantt видят milestones/tasks;
- analytics не расходится с source of truth;
- search находит реальные сущности;
- settings persist корректно;
- нет mock/demo поведения в user-facing production contract.

## Что GLM5 должен вернуть

Нужен отчёт в таком формате:

1. Какие файлы изменены.
2. Какие новые директории/проекты созданы.
3. Какие команды запускались.
4. Что именно проверено руками или тестами.
5. Что осталось нерешённым и почему.
6. Ссылки или пути к артефактам desktop/iPhone build.

## Важные ограничения

- Не ломать текущий Next.js web app.
- Не переписывать продукт целиком на React Native.
- Не возвращать mock/demo fallback в production contract.
- Не менять data model без острой необходимости.
- Если нужен компромисс, сначала сохранять shared codebase и product consistency.
