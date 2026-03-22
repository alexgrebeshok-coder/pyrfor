// Auto-generated demo projects seed
// Generated: 2026-03-21T01:11:11.821867

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(dateStr: string, days: number): Date {
  const date = new Date(dateStr);
  return new Date(date.getTime() + days * DAY_MS);
}

const projects = [
  {
    "id": "proj_000",
    "name": "Реконструкция автодороги Сургут-Нефтеюганск",
    "description": "Капитальный ремонт участка федеральной трассы 15 км, замена покрытия, строительство мостов через р. Обь",
    "status": "active",
    "direction": "construction",
    "priority": "high",
    "health": "good",
    "start": "2025-02-01",
    "end": "2026-07-26",
    "budgetPlan": 160000000,
    "budgetFact": 168000000,
    "progress": 45,
    "location": "Сургут",
    "teamIds": [
      "tm_tatyana",
      "tm_sergey",
      "tm_marina",
      "tm_irina",
      "tm_alexey",
      "tm_natasha",
      "tm_ivan",
      "tm_pavel"
    ],
    "tasks": [
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "critical",
        "dueInDays": 9,
        "assigneeId": "tm_tatyana"
      },
      {
        "title": "Согласование",
        "status": "done",
        "priority": "low",
        "dueInDays": 32,
        "assigneeId": "tm_irina"
      },
      {
        "title": "Закупка материалов",
        "status": "done",
        "priority": "low",
        "dueInDays": 76,
        "assigneeId": "tm_irina"
      },
      {
        "title": "Монтаж",
        "status": "done",
        "priority": "critical",
        "dueInDays": 33,
        "assigneeId": "tm_pavel"
      },
      {
        "title": "Пусконаладка",
        "status": "in_progress",
        "priority": "high",
        "dueInDays": 5,
        "assigneeId": "tm_marina"
      },
      {
        "title": "Сдача объекта",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 48,
        "assigneeId": "tm_alexey"
      },
      {
        "title": "Испытания",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 32,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Документация",
        "status": "todo",
        "priority": "low",
        "dueInDays": 16,
        "assigneeId": "tm_ivan"
      },
      {
        "title": "Подготовка документации",
        "status": "todo",
        "priority": "low",
        "dueInDays": 50,
        "assigneeId": "tm_natasha"
      }
    ],
    "milestones": [
      {
        "title": "Проект",
        "status": "completed",
        "dateOffsetDays": 108,
        "description": "Этап 1"
      },
      {
        "title": "Разрешение",
        "status": "in_progress",
        "dateOffsetDays": 216,
        "description": "Этап 2"
      },
      {
        "title": "Фундамент",
        "status": "upcoming",
        "dateOffsetDays": 323,
        "description": "Этап 3"
      },
      {
        "title": "Каркас",
        "status": "upcoming",
        "dateOffsetDays": 432,
        "description": "Этап 4"
      },
      {
        "title": "Кровля",
        "status": "upcoming",
        "dateOffsetDays": 540,
        "description": "Этап 5"
      }
    ],
    "documents": [
      {
        "title": "Проектная документация",
        "type": "pdf",
        "size": 1554740
      },
      {
        "title": "Смета",
        "type": "xlsx",
        "size": 723167
      },
      {
        "title": "Календарный план",
        "type": "xlsx",
        "size": 222780
      },
      {
        "title": "Договор",
        "type": "docx",
        "size": 291294
      }
    ],
    "risks": [
      {
        "title": "Погодные условия",
        "description": "Короткий строительный сезон",
        "probability": "high",
        "impact": "high",
        "severity": 9,
        "status": "mitigated",
        "ownerId": "tm_sergey"
      },
      {
        "title": "Срыв поставок асфальта",
        "description": "Удалённость от заводов",
        "probability": "medium",
        "impact": "high",
        "severity": 6,
        "status": "mitigated",
        "ownerId": "tm_sergey"
      }
    ]
  },
  {
    "id": "proj_001",
    "name": "Строительство подъездной дороги к пос. Харп",
    "description": "Строительство 8 км дороги с щебёночным покрытием для обеспечения доступа к дунитовому карьеру",
    "status": "at_risk",
    "direction": "construction",
    "priority": "critical",
    "health": "critical",
    "start": "2025-10-28",
    "end": "2026-04-26",
    "budgetPlan": 35000000,
    "budgetFact": 41300000,
    "progress": 32,
    "location": "Салехард",
    "teamIds": [
      "tm_natasha",
      "tm_irina",
      "tm_marina",
      "tm_olga",
      "tm_ivan"
    ],
    "tasks": [
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "high",
        "dueInDays": 15,
        "assigneeId": "tm_irina"
      },
      {
        "title": "Согласование",
        "status": "done",
        "priority": "low",
        "dueInDays": 53,
        "assigneeId": "tm_marina"
      },
      {
        "title": "Закупка материалов",
        "status": "done",
        "priority": "critical",
        "dueInDays": 86,
        "assigneeId": "tm_marina"
      },
      {
        "title": "Монтаж",
        "status": "in_progress",
        "priority": "medium",
        "dueInDays": 52,
        "assigneeId": "tm_marina"
      },
      {
        "title": "Пусконаладка",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 90,
        "assigneeId": "tm_marina"
      },
      {
        "title": "Сдача объекта",
        "status": "todo",
        "priority": "low",
        "dueInDays": 82,
        "assigneeId": "tm_irina"
      },
      {
        "title": "Испытания",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 25,
        "assigneeId": "tm_olga"
      },
      {
        "title": "Документация",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 39,
        "assigneeId": "tm_ivan"
      },
      {
        "title": "Подготовка документации",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 46,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Согласование",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 9,
        "assigneeId": "tm_marina"
      },
      {
        "title": "Закупка материалов",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 39,
        "assigneeId": "tm_natasha"
      }
    ],
    "milestones": [
      {
        "title": "Проект",
        "status": "in_progress",
        "dateOffsetDays": 60,
        "description": "Этап 1"
      },
      {
        "title": "Разрешение",
        "status": "upcoming",
        "dateOffsetDays": 120,
        "description": "Этап 2"
      },
      {
        "title": "Фундамент",
        "status": "upcoming",
        "dateOffsetDays": 180,
        "description": "Этап 3"
      }
    ],
    "documents": [
      {
        "title": "Проектная документация",
        "type": "pdf",
        "size": 2914985
      },
      {
        "title": "Смета",
        "type": "xlsx",
        "size": 794356
      },
      {
        "title": "Календарный план",
        "type": "xlsx",
        "size": 497365
      },
      {
        "title": "Договор",
        "type": "docx",
        "size": 288196
      }
    ],
    "risks": [
      {
        "title": "Вечная мерзлота",
        "description": "Пучение грунтов",
        "probability": "high",
        "impact": "critical",
        "severity": 12,
        "status": "mitigated",
        "ownerId": "tm_irina"
      },
      {
        "title": "Логистика материалов",
        "description": "Зимник только 3 месяца",
        "probability": "high",
        "impact": "high",
        "severity": 9,
        "status": "closed",
        "ownerId": "tm_olga"
      }
    ]
  },
  {
    "id": "proj_002",
    "name": "Ремонт внутригородских дорог - 2 очередь",
    "description": "Ямочный ремонт 45 участков, замена асфальта на центральных улицах",
    "status": "active",
    "direction": "construction",
    "priority": "critical",
    "health": "warning",
    "start": "2025-08-05",
    "end": "2025-12-03",
    "budgetPlan": 45000000,
    "budgetFact": 42750000,
    "progress": 68,
    "location": "Тюмень",
    "teamIds": [
      "tm_sergey",
      "tm_alexey",
      "tm_marina",
      "tm_dmitry",
      "tm_tatyana",
      "tm_natasha"
    ],
    "tasks": [
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "critical",
        "dueInDays": 51,
        "assigneeId": "tm_alexey"
      },
      {
        "title": "Согласование",
        "status": "done",
        "priority": "medium",
        "dueInDays": 70,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Закупка материалов",
        "status": "done",
        "priority": "low",
        "dueInDays": 11,
        "assigneeId": "tm_sergey"
      },
      {
        "title": "Монтаж",
        "status": "done",
        "priority": "medium",
        "dueInDays": 85,
        "assigneeId": "tm_alexey"
      },
      {
        "title": "Пусконаладка",
        "status": "done",
        "priority": "critical",
        "dueInDays": 81,
        "assigneeId": "tm_sergey"
      },
      {
        "title": "Сдача объекта",
        "status": "done",
        "priority": "critical",
        "dueInDays": 53,
        "assigneeId": "tm_tatyana"
      },
      {
        "title": "Испытания",
        "status": "done",
        "priority": "critical",
        "dueInDays": 72,
        "assigneeId": "tm_marina"
      },
      {
        "title": "Документация",
        "status": "done",
        "priority": "low",
        "dueInDays": 19,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "high",
        "dueInDays": 87,
        "assigneeId": "tm_marina"
      },
      {
        "title": "Согласование",
        "status": "in_progress",
        "priority": "low",
        "dueInDays": 42,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Закупка материалов",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 63,
        "assigneeId": "tm_sergey"
      },
      {
        "title": "Монтаж",
        "status": "todo",
        "priority": "high",
        "dueInDays": 69,
        "assigneeId": "tm_alexey"
      },
      {
        "title": "Пусконаладка",
        "status": "todo",
        "priority": "low",
        "dueInDays": 85,
        "assigneeId": "tm_marina"
      },
      {
        "title": "Сдача объекта",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 24,
        "assigneeId": "tm_marina"
      }
    ],
    "milestones": [
      {
        "title": "Проект",
        "status": "completed",
        "dateOffsetDays": 40,
        "description": "Этап 1"
      },
      {
        "title": "Разрешение",
        "status": "in_progress",
        "dateOffsetDays": 80,
        "description": "Этап 2"
      },
      {
        "title": "Фундамент",
        "status": "upcoming",
        "dateOffsetDays": 120,
        "description": "Этап 3"
      }
    ],
    "documents": [
      {
        "title": "Проектная документация",
        "type": "pdf",
        "size": 2131159
      },
      {
        "title": "Смета",
        "type": "xlsx",
        "size": 799908
      },
      {
        "title": "Календарный план",
        "type": "xlsx",
        "size": 478058
      },
      {
        "title": "Договор",
        "type": "docx",
        "size": 100149
      }
    ],
    "risks": [
      {
        "title": "Дожди в мае",
        "description": "Задержка асфальтирования",
        "probability": "medium",
        "impact": "medium",
        "severity": 4,
        "status": "closed",
        "ownerId": "tm_marina"
      }
    ]
  },
  {
    "id": "proj_003",
    "name": "ЖК «Северное сияние» - 3 очередь",
    "description": "Строительство 16-этажного жилого дома на 240 квартир с подземным паркингом",
    "status": "active",
    "direction": "construction",
    "priority": "critical",
    "health": "good",
    "start": "2025-02-12",
    "end": "2027-02-02",
    "budgetPlan": 282000000,
    "budgetFact": 287640000,
    "progress": 72,
    "location": "Тюмень",
    "teamIds": [
      "tm_sergey",
      "tm_marina",
      "tm_ivan",
      "tm_pavel",
      "tm_olga",
      "tm_irina",
      "tm_natasha",
      "tm_dmitry",
      "tm_andrey",
      "tm_alexey"
    ],
    "tasks": [
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "medium",
        "dueInDays": 89,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Согласование",
        "status": "done",
        "priority": "medium",
        "dueInDays": 38,
        "assigneeId": "tm_andrey"
      },
      {
        "title": "Закупка материалов",
        "status": "done",
        "priority": "critical",
        "dueInDays": 32,
        "assigneeId": "tm_andrey"
      },
      {
        "title": "Монтаж",
        "status": "done",
        "priority": "medium",
        "dueInDays": 44,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Пусконаладка",
        "status": "done",
        "priority": "high",
        "dueInDays": 61,
        "assigneeId": "tm_andrey"
      },
      {
        "title": "Сдача объекта",
        "status": "done",
        "priority": "critical",
        "dueInDays": 20,
        "assigneeId": "tm_pavel"
      },
      {
        "title": "Испытания",
        "status": "done",
        "priority": "medium",
        "dueInDays": 13,
        "assigneeId": "tm_irina"
      },
      {
        "title": "Документация",
        "status": "in_progress",
        "priority": "low",
        "dueInDays": 80,
        "assigneeId": "tm_andrey"
      },
      {
        "title": "Подготовка документации",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 80,
        "assigneeId": "tm_pavel"
      },
      {
        "title": "Согласование",
        "status": "todo",
        "priority": "low",
        "dueInDays": 14,
        "assigneeId": "tm_sergey"
      }
    ],
    "milestones": [
      {
        "title": "Проект",
        "status": "completed",
        "dateOffsetDays": 240,
        "description": "Этап 1"
      },
      {
        "title": "Разрешение",
        "status": "in_progress",
        "dateOffsetDays": 480,
        "description": "Этап 2"
      },
      {
        "title": "Фундамент",
        "status": "upcoming",
        "dateOffsetDays": 720,
        "description": "Этап 3"
      }
    ],
    "documents": [
      {
        "title": "Проектная документация",
        "type": "pdf",
        "size": 1141348
      },
      {
        "title": "Смета",
        "type": "xlsx",
        "size": 774700
      },
      {
        "title": "Календарный план",
        "type": "xlsx",
        "size": 216469
      },
      {
        "title": "Договор",
        "type": "docx",
        "size": 186619
      }
    ],
    "risks": [
      {
        "title": "Рост цен на металл",
        "description": "Волатильность рынка",
        "probability": "medium",
        "impact": "high",
        "severity": 6,
        "status": "open",
        "ownerId": "tm_andrey"
      },
      {
        "title": "Кадровый дефицит",
        "description": "Нехватка рабочих",
        "probability": "high",
        "impact": "medium",
        "severity": 6,
        "status": "open",
        "ownerId": "tm_olga"
      }
    ]
  },
  {
    "id": "proj_004",
    "name": "Коттеджный посёлок «Лесная поляна»",
    "description": "Застройка 45 участков с ИЖС, инфраструктура: дороги, газ, электричество, вода",
    "status": "planning",
    "direction": "construction",
    "priority": "critical",
    "health": "warning",
    "start": "2025-09-05",
    "end": "2028-08-20",
    "budgetPlan": 504000000,
    "budgetFact": 504000000,
    "progress": 15,
    "location": "Москва",
    "teamIds": [
      "tm_tatyana",
      "tm_irina",
      "tm_pavel",
      "tm_elena",
      "tm_marina",
      "tm_andrey",
      "tm_dmitry",
      "tm_natasha",
      "tm_olga",
      "tm_ivan",
      "tm_alexey",
      "tm_sergey"
    ],
    "tasks": [
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "critical",
        "dueInDays": 57,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Согласование",
        "status": "in_progress",
        "priority": "low",
        "dueInDays": 88,
        "assigneeId": "tm_alexey"
      },
      {
        "title": "Закупка материалов",
        "status": "todo",
        "priority": "low",
        "dueInDays": 12,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Монтаж",
        "status": "todo",
        "priority": "high",
        "dueInDays": 18,
        "assigneeId": "tm_elena"
      },
      {
        "title": "Пусконаладка",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 29,
        "assigneeId": "tm_olga"
      },
      {
        "title": "Сдача объекта",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 22,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Испытания",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 40,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Документация",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 14,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Подготовка документации",
        "status": "todo",
        "priority": "low",
        "dueInDays": 11,
        "assigneeId": "tm_alexey"
      },
      {
        "title": "Согласование",
        "status": "todo",
        "priority": "low",
        "dueInDays": 16,
        "assigneeId": "tm_elena"
      },
      {
        "title": "Закупка материалов",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 57,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Монтаж",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 32,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Пусконаладка",
        "status": "todo",
        "priority": "low",
        "dueInDays": 26,
        "assigneeId": "tm_dmitry"
      }
    ],
    "milestones": [
      {
        "title": "Проект",
        "status": "upcoming",
        "dateOffsetDays": 360,
        "description": "Этап 1"
      },
      {
        "title": "Разрешение",
        "status": "upcoming",
        "dateOffsetDays": 720,
        "description": "Этап 2"
      },
      {
        "title": "Фундамент",
        "status": "upcoming",
        "dateOffsetDays": 1080,
        "description": "Этап 3"
      }
    ],
    "documents": [
      {
        "title": "Проектная документация",
        "type": "pdf",
        "size": 1818773
      },
      {
        "title": "Смета",
        "type": "xlsx",
        "size": 439042
      },
      {
        "title": "Календарный план",
        "type": "xlsx",
        "size": 438555
      },
      {
        "title": "Договор",
        "type": "docx",
        "size": 174776
      }
    ],
    "risks": [
      {
        "title": "Подключение к сетям",
        "description": "Задержки согласований",
        "probability": "medium",
        "impact": "high",
        "severity": 6,
        "status": "mitigated",
        "ownerId": "tm_sergey"
      },
      {
        "title": "Изменение норм ИЖС",
        "description": "Градостроительный план",
        "probability": "low",
        "impact": "critical",
        "severity": 4,
        "status": "closed",
        "ownerId": "tm_olga"
      }
    ]
  },
  {
    "id": "proj_005",
    "name": "Многоквартирный дом №5 в мкр. Восточный",
    "description": "Панельное 9-этажное здание на 180 квартир, социальная ипотека",
    "status": "active",
    "direction": "construction",
    "priority": "low",
    "health": "good",
    "start": "2025-04-10",
    "end": "2026-12-01",
    "budgetPlan": 189000000,
    "budgetFact": 185220000,
    "progress": 85,
    "location": "Санкт-Петербург",
    "teamIds": [
      "tm_marina",
      "tm_ivan",
      "tm_irina",
      "tm_dmitry",
      "tm_pavel",
      "tm_natasha",
      "tm_alexey",
      "tm_elena"
    ],
    "tasks": [
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "critical",
        "dueInDays": 69,
        "assigneeId": "tm_irina"
      },
      {
        "title": "Согласование",
        "status": "done",
        "priority": "low",
        "dueInDays": 70,
        "assigneeId": "tm_ivan"
      },
      {
        "title": "Закупка материалов",
        "status": "done",
        "priority": "medium",
        "dueInDays": 13,
        "assigneeId": "tm_ivan"
      },
      {
        "title": "Монтаж",
        "status": "done",
        "priority": "medium",
        "dueInDays": 56,
        "assigneeId": "tm_ivan"
      },
      {
        "title": "Пусконаладка",
        "status": "done",
        "priority": "medium",
        "dueInDays": 79,
        "assigneeId": "tm_marina"
      },
      {
        "title": "Сдача объекта",
        "status": "done",
        "priority": "low",
        "dueInDays": 58,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Испытания",
        "status": "in_progress",
        "priority": "high",
        "dueInDays": 31,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Документация",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 38,
        "assigneeId": "tm_alexey"
      }
    ],
    "milestones": [
      {
        "title": "Проект",
        "status": "completed",
        "dateOffsetDays": 199,
        "description": "Этап 1"
      },
      {
        "title": "Разрешение",
        "status": "completed",
        "dateOffsetDays": 399,
        "description": "Этап 2"
      },
      {
        "title": "Фундамент",
        "status": "upcoming",
        "dateOffsetDays": 600,
        "description": "Этап 3"
      }
    ],
    "documents": [
      {
        "title": "Проектная документация",
        "type": "pdf",
        "size": 2408636
      },
      {
        "title": "Смета",
        "type": "xlsx",
        "size": 638428
      },
      {
        "title": "Календарный план",
        "type": "xlsx",
        "size": 357284
      },
      {
        "title": "Договор",
        "type": "docx",
        "size": 219858
      }
    ],
    "risks": [
      {
        "title": "Сроки поставки панелей",
        "description": "Загруженность ДСК",
        "probability": "medium",
        "impact": "high",
        "severity": 6,
        "status": "mitigated",
        "ownerId": "tm_ivan"
      }
    ]
  },
  {
    "id": "proj_006",
    "name": "Апарт-отель «Приморский»",
    "description": "Строительство 12-этажного апарт-отеля на 150 номеров, SPA-зона",
    "status": "on_hold",
    "direction": "construction",
    "priority": "low",
    "health": "warning",
    "start": "2025-10-19",
    "end": "2027-08-10",
    "budgetPlan": 378000000,
    "budgetFact": 408240000,
    "progress": 25,
    "location": "Санкт-Петербург",
    "teamIds": [
      "tm_olga",
      "tm_tatyana",
      "tm_dmitry",
      "tm_marina",
      "tm_sergey",
      "tm_pavel",
      "tm_alexey",
      "tm_ivan",
      "tm_andrey"
    ],
    "tasks": [
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "high",
        "dueInDays": 25,
        "assigneeId": "tm_ivan"
      },
      {
        "title": "Согласование",
        "status": "done",
        "priority": "high",
        "dueInDays": 83,
        "assigneeId": "tm_andrey"
      },
      {
        "title": "Закупка материалов",
        "status": "done",
        "priority": "low",
        "dueInDays": 90,
        "assigneeId": "tm_andrey"
      },
      {
        "title": "Монтаж",
        "status": "in_progress",
        "priority": "high",
        "dueInDays": 89,
        "assigneeId": "tm_tatyana"
      },
      {
        "title": "Пусконаладка",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 38,
        "assigneeId": "tm_tatyana"
      },
      {
        "title": "Сдача объекта",
        "status": "todo",
        "priority": "low",
        "dueInDays": 75,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Испытания",
        "status": "todo",
        "priority": "high",
        "dueInDays": 41,
        "assigneeId": "tm_marina"
      },
      {
        "title": "Документация",
        "status": "todo",
        "priority": "high",
        "dueInDays": 31,
        "assigneeId": "tm_sergey"
      },
      {
        "title": "Подготовка документации",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 37,
        "assigneeId": "tm_olga"
      },
      {
        "title": "Согласование",
        "status": "todo",
        "priority": "low",
        "dueInDays": 86,
        "assigneeId": "tm_alexey"
      },
      {
        "title": "Закупка материалов",
        "status": "todo",
        "priority": "high",
        "dueInDays": 10,
        "assigneeId": "tm_olga"
      },
      {
        "title": "Монтаж",
        "status": "todo",
        "priority": "high",
        "dueInDays": 21,
        "assigneeId": "tm_sergey"
      },
      {
        "title": "Пусконаладка",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 61,
        "assigneeId": "tm_andrey"
      }
    ],
    "milestones": [
      {
        "title": "Проект",
        "status": "in_progress",
        "dateOffsetDays": 132,
        "description": "Этап 1"
      },
      {
        "title": "Разрешение",
        "status": "upcoming",
        "dateOffsetDays": 264,
        "description": "Этап 2"
      },
      {
        "title": "Фундамент",
        "status": "upcoming",
        "dateOffsetDays": 396,
        "description": "Этап 3"
      },
      {
        "title": "Каркас",
        "status": "upcoming",
        "dateOffsetDays": 528,
        "description": "Этап 4"
      },
      {
        "title": "Кровля",
        "status": "upcoming",
        "dateOffsetDays": 660,
        "description": "Этап 5"
      }
    ],
    "documents": [
      {
        "title": "Проектная документация",
        "type": "pdf",
        "size": 1896924
      },
      {
        "title": "Смета",
        "type": "xlsx",
        "size": 594076
      },
      {
        "title": "Календарный план",
        "type": "xlsx",
        "size": 205069
      },
      {
        "title": "Договор",
        "type": "docx",
        "size": 129327
      }
    ],
    "risks": [
      {
        "title": "Приостановка финансирования",
        "description": "Банк заморозил кредит",
        "probability": "high",
        "impact": "critical",
        "severity": 12,
        "status": "open",
        "ownerId": "tm_dmitry"
      }
    ]
  },
  {
    "id": "proj_007",
    "name": "Складской комплекс класса А+ «Южные ворота»",
    "description": "50 000 м² складских площадей с кросс-доком и автоматизированной системой хранения",
    "status": "active",
    "direction": "construction",
    "priority": "high",
    "health": "warning",
    "start": "2025-10-18",
    "end": "2027-02-10",
    "budgetPlan": 427000000,
    "budgetFact": 478240000,
    "progress": 58,
    "location": "Москва",
    "teamIds": [
      "tm_alexey",
      "tm_andrey",
      "tm_tatyana",
      "tm_ivan",
      "tm_sergey",
      "tm_irina",
      "tm_dmitry",
      "tm_pavel",
      "tm_olga"
    ],
    "tasks": [
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "low",
        "dueInDays": 50,
        "assigneeId": "tm_olga"
      },
      {
        "title": "Согласование",
        "status": "done",
        "priority": "critical",
        "dueInDays": 84,
        "assigneeId": "tm_tatyana"
      },
      {
        "title": "Закупка материалов",
        "status": "done",
        "priority": "medium",
        "dueInDays": 25,
        "assigneeId": "tm_tatyana"
      },
      {
        "title": "Монтаж",
        "status": "done",
        "priority": "critical",
        "dueInDays": 8,
        "assigneeId": "tm_tatyana"
      },
      {
        "title": "Пусконаладка",
        "status": "done",
        "priority": "high",
        "dueInDays": 57,
        "assigneeId": "tm_ivan"
      },
      {
        "title": "Сдача объекта",
        "status": "done",
        "priority": "high",
        "dueInDays": 25,
        "assigneeId": "tm_andrey"
      },
      {
        "title": "Испытания",
        "status": "in_progress",
        "priority": "critical",
        "dueInDays": 9,
        "assigneeId": "tm_pavel"
      },
      {
        "title": "Документация",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 30,
        "assigneeId": "tm_pavel"
      },
      {
        "title": "Подготовка документации",
        "status": "todo",
        "priority": "high",
        "dueInDays": 44,
        "assigneeId": "tm_ivan"
      },
      {
        "title": "Согласование",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 8,
        "assigneeId": "tm_ivan"
      },
      {
        "title": "Закупка материалов",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 47,
        "assigneeId": "tm_sergey"
      }
    ],
    "milestones": [
      {
        "title": "Проект",
        "status": "completed",
        "dateOffsetDays": 160,
        "description": "Этап 1"
      },
      {
        "title": "Разрешение",
        "status": "in_progress",
        "dateOffsetDays": 320,
        "description": "Этап 2"
      },
      {
        "title": "Фундамент",
        "status": "upcoming",
        "dateOffsetDays": 480,
        "description": "Этап 3"
      }
    ],
    "documents": [
      {
        "title": "Проектная документация",
        "type": "pdf",
        "size": 2621783
      },
      {
        "title": "Смета",
        "type": "xlsx",
        "size": 446341
      },
      {
        "title": "Календарный план",
        "type": "xlsx",
        "size": 384101
      },
      {
        "title": "Договор",
        "type": "docx",
        "size": 268160
      }
    ],
    "risks": [
      {
        "title": "Санкции на оборудование",
        "description": "Немецкое оборудование",
        "probability": "high",
        "impact": "critical",
        "severity": 12,
        "status": "closed",
        "ownerId": "tm_dmitry"
      },
      {
        "title": "Рост ставок аренды земли",
        "description": "Кадастровая стоимость",
        "probability": "medium",
        "impact": "medium",
        "severity": 4,
        "status": "closed",
        "ownerId": "tm_olga"
      }
    ]
  },
  {
    "id": "proj_008",
    "name": "Завод металлоконструкций «СеверСталь» - 2 очередь",
    "description": "Расширение производственных мощностей, новый цех 8000 м²",
    "status": "completed",
    "direction": "metallurgy",
    "priority": "high",
    "health": "good",
    "start": "2025-01-04",
    "end": "2026-08-27",
    "budgetPlan": 280000000,
    "budgetFact": 271600000,
    "progress": 100,
    "location": "Тюмень",
    "teamIds": [
      "tm_sergey",
      "tm_alexey",
      "tm_irina",
      "tm_tatyana",
      "tm_ivan",
      "tm_elena",
      "tm_dmitry",
      "tm_marina",
      "tm_pavel"
    ],
    "tasks": [
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "critical",
        "dueInDays": 82,
        "assigneeId": "tm_pavel"
      },
      {
        "title": "Согласование",
        "status": "done",
        "priority": "low",
        "dueInDays": 54,
        "assigneeId": "tm_tatyana"
      },
      {
        "title": "Закупка материалов",
        "status": "done",
        "priority": "high",
        "dueInDays": 10,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Монтаж",
        "status": "done",
        "priority": "low",
        "dueInDays": 71,
        "assigneeId": "tm_pavel"
      },
      {
        "title": "Пусконаладка",
        "status": "done",
        "priority": "medium",
        "dueInDays": 51,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Сдача объекта",
        "status": "done",
        "priority": "low",
        "dueInDays": 90,
        "assigneeId": "tm_elena"
      },
      {
        "title": "Испытания",
        "status": "done",
        "priority": "high",
        "dueInDays": 89,
        "assigneeId": "tm_alexey"
      },
      {
        "title": "Документация",
        "status": "done",
        "priority": "high",
        "dueInDays": 69,
        "assigneeId": "tm_ivan"
      },
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "critical",
        "dueInDays": 46,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Согласование",
        "status": "done",
        "priority": "high",
        "dueInDays": 75,
        "assigneeId": "tm_irina"
      },
      {
        "title": "Закупка материалов",
        "status": "done",
        "priority": "medium",
        "dueInDays": 58,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Монтаж",
        "status": "done",
        "priority": "medium",
        "dueInDays": 83,
        "assigneeId": "tm_ivan"
      },
      {
        "title": "Пусконаладка",
        "status": "in_progress",
        "priority": "critical",
        "dueInDays": 75,
        "assigneeId": "tm_sergey"
      }
    ],
    "milestones": [
      {
        "title": "Проект",
        "status": "completed",
        "dateOffsetDays": 150,
        "description": "Этап 1"
      },
      {
        "title": "Разрешение",
        "status": "completed",
        "dateOffsetDays": 300,
        "description": "Этап 2"
      },
      {
        "title": "Фундамент",
        "status": "completed",
        "dateOffsetDays": 450,
        "description": "Этап 3"
      },
      {
        "title": "Каркас",
        "status": "in_progress",
        "dateOffsetDays": 600,
        "description": "Этап 4"
      }
    ],
    "documents": [
      {
        "title": "Проектная документация",
        "type": "pdf",
        "size": 1601701
      },
      {
        "title": "Смета",
        "type": "xlsx",
        "size": 410196
      },
      {
        "title": "Календарный план",
        "type": "xlsx",
        "size": 425385
      },
      {
        "title": "Договор",
        "type": "docx",
        "size": 252039
      }
    ],
    "risks": []
  },
  {
    "id": "proj_009",
    "name": "Благоустройство парка «Городской сад»",
    "description": "Реконструкция парковой зоны: дорожки, освещение, детские площадки, фонтан",
    "status": "active",
    "direction": "construction",
    "priority": "medium",
    "health": "good",
    "start": "2025-08-15",
    "end": "2026-05-12",
    "budgetPlan": 69000000,
    "budgetFact": 69690000,
    "progress": 40,
    "location": "Тюмень",
    "teamIds": [
      "tm_pavel",
      "tm_marina",
      "tm_dmitry",
      "tm_elena",
      "tm_alexey",
      "tm_natasha"
    ],
    "tasks": [
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "high",
        "dueInDays": 70,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Согласование",
        "status": "done",
        "priority": "high",
        "dueInDays": 16,
        "assigneeId": "tm_marina"
      },
      {
        "title": "Закупка материалов",
        "status": "done",
        "priority": "high",
        "dueInDays": 33,
        "assigneeId": "tm_marina"
      },
      {
        "title": "Монтаж",
        "status": "in_progress",
        "priority": "medium",
        "dueInDays": 8,
        "assigneeId": "tm_pavel"
      },
      {
        "title": "Пусконаладка",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 65,
        "assigneeId": "tm_alexey"
      },
      {
        "title": "Сдача объекта",
        "status": "todo",
        "priority": "low",
        "dueInDays": 63,
        "assigneeId": "tm_elena"
      },
      {
        "title": "Испытания",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 54,
        "assigneeId": "tm_elena"
      },
      {
        "title": "Документация",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 36,
        "assigneeId": "tm_marina"
      },
      {
        "title": "Подготовка документации",
        "status": "todo",
        "priority": "low",
        "dueInDays": 18,
        "assigneeId": "tm_elena"
      }
    ],
    "milestones": [
      {
        "title": "Проект",
        "status": "in_progress",
        "dateOffsetDays": 90,
        "description": "Этап 1"
      },
      {
        "title": "Разрешение",
        "status": "upcoming",
        "dateOffsetDays": 180,
        "description": "Этап 2"
      },
      {
        "title": "Фундамент",
        "status": "upcoming",
        "dateOffsetDays": 270,
        "description": "Этап 3"
      }
    ],
    "documents": [
      {
        "title": "Проектная документация",
        "type": "pdf",
        "size": 1368861
      },
      {
        "title": "Смета",
        "type": "xlsx",
        "size": 721585
      },
      {
        "title": "Календарный план",
        "type": "xlsx",
        "size": 471559
      },
      {
        "title": "Договор",
        "type": "docx",
        "size": 221778
      }
    ],
    "risks": [
      {
        "title": "Бюджетные ограничения",
        "description": "Секвестр бюджета",
        "probability": "medium",
        "impact": "high",
        "severity": 6,
        "status": "open",
        "ownerId": "tm_alexey"
      }
    ]
  },
  {
    "id": "proj_010",
    "name": "Спортивный комплекс «Ледовый дворец»",
    "description": "Ледовый дворец на 2000 мест, бассейн, тренажёрный зал",
    "status": "active",
    "direction": "construction",
    "priority": "critical",
    "health": "warning",
    "start": "2025-08-05",
    "end": "2027-05-27",
    "budgetPlan": 335000000,
    "budgetFact": 385250000,
    "progress": 52,
    "location": "Новосибирск",
    "teamIds": [
      "tm_elena",
      "tm_pavel",
      "tm_dmitry",
      "tm_irina",
      "tm_natasha",
      "tm_andrey",
      "tm_marina",
      "tm_sergey",
      "tm_tatyana",
      "tm_alexey",
      "tm_olga"
    ],
    "tasks": [
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "critical",
        "dueInDays": 62,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Согласование",
        "status": "done",
        "priority": "medium",
        "dueInDays": 86,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Закупка материалов",
        "status": "done",
        "priority": "critical",
        "dueInDays": 85,
        "assigneeId": "tm_irina"
      },
      {
        "title": "Монтаж",
        "status": "done",
        "priority": "high",
        "dueInDays": 61,
        "assigneeId": "tm_pavel"
      },
      {
        "title": "Пусконаладка",
        "status": "done",
        "priority": "high",
        "dueInDays": 35,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Сдача объекта",
        "status": "in_progress",
        "priority": "high",
        "dueInDays": 45,
        "assigneeId": "tm_tatyana"
      },
      {
        "title": "Испытания",
        "status": "todo",
        "priority": "low",
        "dueInDays": 22,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Документация",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 54,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Подготовка документации",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 13,
        "assigneeId": "tm_marina"
      },
      {
        "title": "Согласование",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 47,
        "assigneeId": "tm_tatyana"
      }
    ],
    "milestones": [
      {
        "title": "Проект",
        "status": "completed",
        "dateOffsetDays": 165,
        "description": "Этап 1"
      },
      {
        "title": "Разрешение",
        "status": "in_progress",
        "dateOffsetDays": 330,
        "description": "Этап 2"
      },
      {
        "title": "Фундамент",
        "status": "upcoming",
        "dateOffsetDays": 495,
        "description": "Этап 3"
      },
      {
        "title": "Каркас",
        "status": "upcoming",
        "dateOffsetDays": 660,
        "description": "Этап 4"
      }
    ],
    "documents": [
      {
        "title": "Проектная документация",
        "type": "pdf",
        "size": 1871941
      },
      {
        "title": "Смета",
        "type": "xlsx",
        "size": 332645
      },
      {
        "title": "Календарный план",
        "type": "xlsx",
        "size": 308440
      },
      {
        "title": "Договор",
        "type": "docx",
        "size": 210138
      }
    ],
    "risks": [
      {
        "title": "Оборудование для льда",
        "description": "Санкции на холодильное",
        "probability": "medium",
        "impact": "high",
        "severity": 6,
        "status": "mitigated",
        "ownerId": "tm_alexey"
      },
      {
        "title": "Федеральное финансирование",
        "description": "Зависимость от ФЦП",
        "probability": "low",
        "impact": "high",
        "severity": 3,
        "status": "closed",
        "ownerId": "tm_elena"
      }
    ]
  },
  {
    "id": "proj_011",
    "name": "Реконструкция набережной р. Оби",
    "description": "Благоустройство 2.5 км набережной, прогулочные зоны, причал",
    "status": "active",
    "direction": "construction",
    "priority": "medium",
    "health": "good",
    "start": "2025-01-12",
    "end": "2026-04-07",
    "budgetPlan": 170000000,
    "budgetFact": 175100000,
    "progress": 78,
    "location": "Сургут",
    "teamIds": [
      "tm_sergey",
      "tm_andrey",
      "tm_pavel",
      "tm_dmitry",
      "tm_marina",
      "tm_elena",
      "tm_olga",
      "tm_alexey"
    ],
    "tasks": [
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "critical",
        "dueInDays": 8,
        "assigneeId": "tm_olga"
      },
      {
        "title": "Согласование",
        "status": "done",
        "priority": "high",
        "dueInDays": 90,
        "assigneeId": "tm_olga"
      },
      {
        "title": "Закупка материалов",
        "status": "done",
        "priority": "medium",
        "dueInDays": 64,
        "assigneeId": "tm_pavel"
      },
      {
        "title": "Монтаж",
        "status": "done",
        "priority": "low",
        "dueInDays": 55,
        "assigneeId": "tm_sergey"
      },
      {
        "title": "Пусконаладка",
        "status": "done",
        "priority": "low",
        "dueInDays": 87,
        "assigneeId": "tm_olga"
      },
      {
        "title": "Сдача объекта",
        "status": "done",
        "priority": "medium",
        "dueInDays": 64,
        "assigneeId": "tm_pavel"
      },
      {
        "title": "Испытания",
        "status": "done",
        "priority": "low",
        "dueInDays": 38,
        "assigneeId": "tm_olga"
      },
      {
        "title": "Документация",
        "status": "done",
        "priority": "high",
        "dueInDays": 32,
        "assigneeId": "tm_alexey"
      },
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "high",
        "dueInDays": 48,
        "assigneeId": "tm_olga"
      },
      {
        "title": "Согласование",
        "status": "done",
        "priority": "high",
        "dueInDays": 58,
        "assigneeId": "tm_marina"
      },
      {
        "title": "Закупка материалов",
        "status": "in_progress",
        "priority": "low",
        "dueInDays": 65,
        "assigneeId": "tm_sergey"
      },
      {
        "title": "Монтаж",
        "status": "todo",
        "priority": "low",
        "dueInDays": 49,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Пусконаладка",
        "status": "todo",
        "priority": "low",
        "dueInDays": 88,
        "assigneeId": "tm_sergey"
      },
      {
        "title": "Сдача объекта",
        "status": "todo",
        "priority": "low",
        "dueInDays": 36,
        "assigneeId": "tm_dmitry"
      }
    ],
    "milestones": [
      {
        "title": "Проект",
        "status": "completed",
        "dateOffsetDays": 150,
        "description": "Этап 1"
      },
      {
        "title": "Разрешение",
        "status": "completed",
        "dateOffsetDays": 300,
        "description": "Этап 2"
      },
      {
        "title": "Фундамент",
        "status": "upcoming",
        "dateOffsetDays": 450,
        "description": "Этап 3"
      }
    ],
    "documents": [
      {
        "title": "Проектная документация",
        "type": "pdf",
        "size": 2303035
      },
      {
        "title": "Смета",
        "type": "xlsx",
        "size": 379892
      },
      {
        "title": "Календарный план",
        "type": "xlsx",
        "size": 325066
      },
      {
        "title": "Договор",
        "type": "docx",
        "size": 133088
      }
    ],
    "risks": [
      {
        "title": "Паводок",
        "description": "Весенний разлив реки",
        "probability": "high",
        "impact": "critical",
        "severity": 12,
        "status": "mitigated",
        "ownerId": "tm_andrey"
      }
    ]
  },
  {
    "id": "proj_012",
    "name": "Модернизация котельной №12",
    "description": "Замена котлов, установка системы автоматизации, переход на газ",
    "status": "at_risk",
    "direction": "construction",
    "priority": "medium",
    "health": "critical",
    "start": "2025-12-09",
    "end": "2026-07-07",
    "budgetPlan": 45000000,
    "budgetFact": 54900000,
    "progress": 65,
    "location": "Санкт-Петербург",
    "teamIds": [
      "tm_natasha",
      "tm_alexey",
      "tm_irina",
      "tm_olga",
      "tm_pavel"
    ],
    "tasks": [
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "low",
        "dueInDays": 79,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Согласование",
        "status": "done",
        "priority": "high",
        "dueInDays": 78,
        "assigneeId": "tm_olga"
      },
      {
        "title": "Закупка материалов",
        "status": "done",
        "priority": "critical",
        "dueInDays": 30,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Монтаж",
        "status": "done",
        "priority": "medium",
        "dueInDays": 18,
        "assigneeId": "tm_irina"
      },
      {
        "title": "Пусконаладка",
        "status": "done",
        "priority": "low",
        "dueInDays": 77,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Сдача объекта",
        "status": "done",
        "priority": "high",
        "dueInDays": 73,
        "assigneeId": "tm_olga"
      },
      {
        "title": "Испытания",
        "status": "done",
        "priority": "high",
        "dueInDays": 13,
        "assigneeId": "tm_pavel"
      },
      {
        "title": "Документация",
        "status": "in_progress",
        "priority": "high",
        "dueInDays": 6,
        "assigneeId": "tm_olga"
      },
      {
        "title": "Подготовка документации",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 18,
        "assigneeId": "tm_olga"
      },
      {
        "title": "Согласование",
        "status": "todo",
        "priority": "high",
        "dueInDays": 86,
        "assigneeId": "tm_olga"
      },
      {
        "title": "Закупка материалов",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 60,
        "assigneeId": "tm_alexey"
      },
      {
        "title": "Монтаж",
        "status": "todo",
        "priority": "high",
        "dueInDays": 83,
        "assigneeId": "tm_pavel"
      }
    ],
    "milestones": [
      {
        "title": "Проект",
        "status": "completed",
        "dateOffsetDays": 52,
        "description": "Этап 1"
      },
      {
        "title": "Разрешение",
        "status": "completed",
        "dateOffsetDays": 105,
        "description": "Этап 2"
      },
      {
        "title": "Фундамент",
        "status": "upcoming",
        "dateOffsetDays": 157,
        "description": "Этап 3"
      },
      {
        "title": "Каркас",
        "status": "upcoming",
        "dateOffsetDays": 210,
        "description": "Этап 4"
      }
    ],
    "documents": [
      {
        "title": "Проектная документация",
        "type": "pdf",
        "size": 1974910
      },
      {
        "title": "Смета",
        "type": "xlsx",
        "size": 528366
      },
      {
        "title": "Календарный план",
        "type": "xlsx",
        "size": 340716
      },
      {
        "title": "Договор",
        "type": "docx",
        "size": 184490
      }
    ],
    "risks": [
      {
        "title": "Аварийные работы зимой",
        "description": "Отопительный сезон",
        "probability": "medium",
        "impact": "critical",
        "severity": 8,
        "status": "open",
        "ownerId": "tm_natasha"
      },
      {
        "title": "Поставка оборудования",
        "description": "Зарубежные котлы",
        "probability": "high",
        "impact": "high",
        "severity": 9,
        "status": "mitigated",
        "ownerId": "tm_olga"
      }
    ]
  },
  {
    "id": "proj_013",
    "name": "Капитальный ремонт кровли школы №42",
    "description": "Замена мягкой кровли 2500 м², утепление, водосточная система",
    "status": "completed",
    "direction": "construction",
    "priority": "medium",
    "health": "good",
    "start": "2025-10-20",
    "end": "2026-01-18",
    "budgetPlan": 11000000,
    "budgetFact": 10340000,
    "progress": 100,
    "location": "Краснодар",
    "teamIds": [
      "tm_pavel",
      "tm_andrey",
      "tm_natasha"
    ],
    "tasks": [
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "critical",
        "dueInDays": 46,
        "assigneeId": "tm_pavel"
      },
      {
        "title": "Согласование",
        "status": "done",
        "priority": "critical",
        "dueInDays": 32,
        "assigneeId": "tm_andrey"
      },
      {
        "title": "Закупка материалов",
        "status": "done",
        "priority": "high",
        "dueInDays": 48,
        "assigneeId": "tm_andrey"
      },
      {
        "title": "Монтаж",
        "status": "done",
        "priority": "high",
        "dueInDays": 76,
        "assigneeId": "tm_pavel"
      },
      {
        "title": "Пусконаладка",
        "status": "done",
        "priority": "medium",
        "dueInDays": 15,
        "assigneeId": "tm_pavel"
      },
      {
        "title": "Сдача объекта",
        "status": "done",
        "priority": "critical",
        "dueInDays": 67,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Испытания",
        "status": "done",
        "priority": "medium",
        "dueInDays": 65,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Документация",
        "status": "in_progress",
        "priority": "critical",
        "dueInDays": 62,
        "assigneeId": "tm_pavel"
      }
    ],
    "milestones": [
      {
        "title": "Проект",
        "status": "completed",
        "dateOffsetDays": 30,
        "description": "Этап 1"
      },
      {
        "title": "Разрешение",
        "status": "completed",
        "dateOffsetDays": 60,
        "description": "Этап 2"
      },
      {
        "title": "Фундамент",
        "status": "in_progress",
        "dateOffsetDays": 90,
        "description": "Этап 3"
      }
    ],
    "documents": [
      {
        "title": "Проектная документация",
        "type": "pdf",
        "size": 1617056
      },
      {
        "title": "Смета",
        "type": "xlsx",
        "size": 416180
      },
      {
        "title": "Календарный план",
        "type": "xlsx",
        "size": 412022
      },
      {
        "title": "Договор",
        "type": "docx",
        "size": 281347
      }
    ],
    "risks": []
  },
  {
    "id": "proj_014",
    "name": "Логистический хаб «Западный»",
    "description": "Централизованная база для дистрибуции FMCG по ЦФО, 30 грузовиков, 5000 м² склада",
    "status": "active",
    "direction": "logistics",
    "priority": "low",
    "health": "good",
    "start": "2025-11-19",
    "end": "2026-11-14",
    "budgetPlan": 94000000,
    "budgetFact": 97760000,
    "progress": 62,
    "location": "Москва",
    "teamIds": [
      "tm_natasha",
      "tm_elena",
      "tm_dmitry",
      "tm_irina",
      "tm_tatyana",
      "tm_marina",
      "tm_pavel"
    ],
    "tasks": [
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "high",
        "dueInDays": 50,
        "assigneeId": "tm_marina"
      },
      {
        "title": "Согласование",
        "status": "done",
        "priority": "critical",
        "dueInDays": 39,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Закупка материалов",
        "status": "done",
        "priority": "high",
        "dueInDays": 34,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Монтаж",
        "status": "done",
        "priority": "medium",
        "dueInDays": 45,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Пусконаладка",
        "status": "done",
        "priority": "medium",
        "dueInDays": 29,
        "assigneeId": "tm_elena"
      },
      {
        "title": "Сдача объекта",
        "status": "done",
        "priority": "critical",
        "dueInDays": 40,
        "assigneeId": "tm_marina"
      },
      {
        "title": "Испытания",
        "status": "done",
        "priority": "high",
        "dueInDays": 17,
        "assigneeId": "tm_pavel"
      },
      {
        "title": "Документация",
        "status": "done",
        "priority": "medium",
        "dueInDays": 42,
        "assigneeId": "tm_elena"
      },
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "high",
        "dueInDays": 27,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Согласование",
        "status": "in_progress",
        "priority": "low",
        "dueInDays": 73,
        "assigneeId": "tm_elena"
      },
      {
        "title": "Закупка материалов",
        "status": "todo",
        "priority": "high",
        "dueInDays": 10,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Монтаж",
        "status": "todo",
        "priority": "high",
        "dueInDays": 21,
        "assigneeId": "tm_marina"
      },
      {
        "title": "Пусконаладка",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 18,
        "assigneeId": "tm_pavel"
      },
      {
        "title": "Сдача объекта",
        "status": "todo",
        "priority": "low",
        "dueInDays": 78,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Испытания",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 66,
        "assigneeId": "tm_irina"
      },
      {
        "title": "Документация",
        "status": "todo",
        "priority": "high",
        "dueInDays": 28,
        "assigneeId": "tm_natasha"
      }
    ],
    "milestones": [
      {
        "title": "Проект",
        "status": "completed",
        "dateOffsetDays": 90,
        "description": "Этап 1"
      },
      {
        "title": "Разрешение",
        "status": "completed",
        "dateOffsetDays": 180,
        "description": "Этап 2"
      },
      {
        "title": "Фундамент",
        "status": "upcoming",
        "dateOffsetDays": 270,
        "description": "Этап 3"
      },
      {
        "title": "Каркас",
        "status": "upcoming",
        "dateOffsetDays": 360,
        "description": "Этап 4"
      }
    ],
    "documents": [
      {
        "title": "Проектная документация",
        "type": "pdf",
        "size": 2973553
      },
      {
        "title": "Смета",
        "type": "xlsx",
        "size": 751791
      },
      {
        "title": "Календарный план",
        "type": "xlsx",
        "size": 450467
      },
      {
        "title": "Договор",
        "type": "docx",
        "size": 129907
      }
    ],
    "risks": [
      {
        "title": "Дефицит водителей",
        "description": "Отток кадров",
        "probability": "high",
        "impact": "high",
        "severity": 9,
        "status": "open",
        "ownerId": "tm_irina"
      },
      {
        "title": "Рост топлива",
        "description": "Волатильность ДТ",
        "probability": "medium",
        "impact": "medium",
        "severity": 4,
        "status": "mitigated",
        "ownerId": "tm_natasha"
      }
    ]
  },
  {
    "id": "proj_015",
    "name": "Международные перевозки Казахстан-Россия",
    "description": "Открытие маршрута Астана-Москва-Екатеринбург для доставки стройматериалов",
    "status": "active",
    "direction": "logistics",
    "priority": "high",
    "health": "warning",
    "start": "2025-03-26",
    "end": "2025-11-21",
    "budgetPlan": 37000000,
    "budgetFact": 40330000,
    "progress": 38,
    "location": "Астана, Казахстан",
    "teamIds": [
      "tm_irina",
      "tm_sergey",
      "tm_olga",
      "tm_marina",
      "tm_tatyana"
    ],
    "tasks": [
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "critical",
        "dueInDays": 82,
        "assigneeId": "tm_tatyana"
      },
      {
        "title": "Согласование",
        "status": "done",
        "priority": "medium",
        "dueInDays": 71,
        "assigneeId": "tm_marina"
      },
      {
        "title": "Закупка материалов",
        "status": "done",
        "priority": "critical",
        "dueInDays": 61,
        "assigneeId": "tm_olga"
      },
      {
        "title": "Монтаж",
        "status": "done",
        "priority": "critical",
        "dueInDays": 44,
        "assigneeId": "tm_tatyana"
      },
      {
        "title": "Пусконаладка",
        "status": "done",
        "priority": "low",
        "dueInDays": 83,
        "assigneeId": "tm_irina"
      },
      {
        "title": "Сдача объекта",
        "status": "done",
        "priority": "medium",
        "dueInDays": 85,
        "assigneeId": "tm_sergey"
      },
      {
        "title": "Испытания",
        "status": "in_progress",
        "priority": "high",
        "dueInDays": 89,
        "assigneeId": "tm_irina"
      },
      {
        "title": "Документация",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 35,
        "assigneeId": "tm_sergey"
      },
      {
        "title": "Подготовка документации",
        "status": "todo",
        "priority": "low",
        "dueInDays": 25,
        "assigneeId": "tm_irina"
      },
      {
        "title": "Согласование",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 62,
        "assigneeId": "tm_tatyana"
      },
      {
        "title": "Закупка материалов",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 42,
        "assigneeId": "tm_irina"
      },
      {
        "title": "Монтаж",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 41,
        "assigneeId": "tm_olga"
      },
      {
        "title": "Пусконаладка",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 14,
        "assigneeId": "tm_sergey"
      },
      {
        "title": "Сдача объекта",
        "status": "todo",
        "priority": "high",
        "dueInDays": 85,
        "assigneeId": "tm_tatyana"
      },
      {
        "title": "Испытания",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 59,
        "assigneeId": "tm_irina"
      },
      {
        "title": "Документация",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 87,
        "assigneeId": "tm_sergey"
      }
    ],
    "milestones": [
      {
        "title": "Проект",
        "status": "completed",
        "dateOffsetDays": 60,
        "description": "Этап 1"
      },
      {
        "title": "Разрешение",
        "status": "upcoming",
        "dateOffsetDays": 120,
        "description": "Этап 2"
      },
      {
        "title": "Фундамент",
        "status": "upcoming",
        "dateOffsetDays": 180,
        "description": "Этап 3"
      },
      {
        "title": "Каркас",
        "status": "upcoming",
        "dateOffsetDays": 240,
        "description": "Этап 4"
      }
    ],
    "documents": [
      {
        "title": "Проектная документация",
        "type": "pdf",
        "size": 2733571
      },
      {
        "title": "Смета",
        "type": "xlsx",
        "size": 374572
      },
      {
        "title": "Календарный план",
        "type": "xlsx",
        "size": 237439
      },
      {
        "title": "Договор",
        "type": "docx",
        "size": 115633
      }
    ],
    "risks": [
      {
        "title": "Таможенное оформление",
        "description": "Задержки на границе",
        "probability": "medium",
        "impact": "high",
        "severity": 6,
        "status": "open",
        "ownerId": "tm_olga"
      },
      {
        "title": "Курс тенге/рубль",
        "description": "Валютные риски",
        "probability": "high",
        "impact": "medium",
        "severity": 6,
        "status": "closed",
        "ownerId": "tm_tatyana"
      }
    ]
  },
  {
    "id": "proj_016",
    "name": "Доставка щебня на объекты ЯНАО",
    "description": "Организация зимников и доставка 50 000 м³ щебня из карьеров ХМАО",
    "status": "completed",
    "direction": "logistics",
    "priority": "critical",
    "health": "good",
    "start": "2025-02-15",
    "end": "2025-06-15",
    "budgetPlan": 25000000,
    "budgetFact": 22750000,
    "progress": 100,
    "location": "Сургут",
    "teamIds": [
      "tm_tatyana",
      "tm_sergey",
      "tm_andrey",
      "tm_pavel"
    ],
    "tasks": [
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "critical",
        "dueInDays": 61,
        "assigneeId": "tm_tatyana"
      },
      {
        "title": "Согласование",
        "status": "done",
        "priority": "low",
        "dueInDays": 60,
        "assigneeId": "tm_andrey"
      },
      {
        "title": "Закупка материалов",
        "status": "done",
        "priority": "high",
        "dueInDays": 8,
        "assigneeId": "tm_tatyana"
      },
      {
        "title": "Монтаж",
        "status": "done",
        "priority": "medium",
        "dueInDays": 78,
        "assigneeId": "tm_tatyana"
      },
      {
        "title": "Пусконаладка",
        "status": "done",
        "priority": "high",
        "dueInDays": 78,
        "assigneeId": "tm_tatyana"
      },
      {
        "title": "Сдача объекта",
        "status": "done",
        "priority": "medium",
        "dueInDays": 65,
        "assigneeId": "tm_pavel"
      },
      {
        "title": "Испытания",
        "status": "done",
        "priority": "high",
        "dueInDays": 28,
        "assigneeId": "tm_pavel"
      },
      {
        "title": "Документация",
        "status": "done",
        "priority": "critical",
        "dueInDays": 16,
        "assigneeId": "tm_pavel"
      },
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "high",
        "dueInDays": 57,
        "assigneeId": "tm_andrey"
      },
      {
        "title": "Согласование",
        "status": "done",
        "priority": "high",
        "dueInDays": 90,
        "assigneeId": "tm_tatyana"
      },
      {
        "title": "Закупка материалов",
        "status": "done",
        "priority": "medium",
        "dueInDays": 47,
        "assigneeId": "tm_pavel"
      },
      {
        "title": "Монтаж",
        "status": "done",
        "priority": "critical",
        "dueInDays": 41,
        "assigneeId": "tm_pavel"
      },
      {
        "title": "Пусконаладка",
        "status": "done",
        "priority": "low",
        "dueInDays": 63,
        "assigneeId": "tm_tatyana"
      },
      {
        "title": "Сдача объекта",
        "status": "done",
        "priority": "high",
        "dueInDays": 37,
        "assigneeId": "tm_andrey"
      },
      {
        "title": "Испытания",
        "status": "done",
        "priority": "low",
        "dueInDays": 56,
        "assigneeId": "tm_tatyana"
      },
      {
        "title": "Документация",
        "status": "in_progress",
        "priority": "critical",
        "dueInDays": 57,
        "assigneeId": "tm_tatyana"
      }
    ],
    "milestones": [
      {
        "title": "Проект",
        "status": "completed",
        "dateOffsetDays": 40,
        "description": "Этап 1"
      },
      {
        "title": "Разрешение",
        "status": "completed",
        "dateOffsetDays": 80,
        "description": "Этап 2"
      },
      {
        "title": "Фундамент",
        "status": "in_progress",
        "dateOffsetDays": 120,
        "description": "Этап 3"
      }
    ],
    "documents": [
      {
        "title": "Проектная документация",
        "type": "pdf",
        "size": 2087246
      },
      {
        "title": "Смета",
        "type": "xlsx",
        "size": 489676
      },
      {
        "title": "Календарный план",
        "type": "xlsx",
        "size": 461353
      },
      {
        "title": "Договор",
        "type": "docx",
        "size": 263947
      }
    ],
    "risks": []
  },
  {
    "id": "proj_017",
    "name": "Автопарк «Юг-Транс»",
    "description": "Создание автопарка на 50 грузовиков для междугородних перевозок",
    "status": "planning",
    "direction": "logistics",
    "priority": "medium",
    "health": "warning",
    "start": "2025-04-09",
    "end": "2025-10-06",
    "budgetPlan": 76000000,
    "budgetFact": 76000000,
    "progress": 12,
    "location": "Краснодар",
    "teamIds": [
      "tm_dmitry",
      "tm_alexey",
      "tm_sergey",
      "tm_elena",
      "tm_tatyana",
      "tm_ivan"
    ],
    "tasks": [
      {
        "title": "Подготовка документации",
        "status": "in_progress",
        "priority": "medium",
        "dueInDays": 25,
        "assigneeId": "tm_sergey"
      },
      {
        "title": "Согласование",
        "status": "todo",
        "priority": "low",
        "dueInDays": 75,
        "assigneeId": "tm_elena"
      },
      {
        "title": "Закупка материалов",
        "status": "todo",
        "priority": "low",
        "dueInDays": 33,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Монтаж",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 20,
        "assigneeId": "tm_ivan"
      },
      {
        "title": "Пусконаладка",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 68,
        "assigneeId": "tm_ivan"
      },
      {
        "title": "Сдача объекта",
        "status": "todo",
        "priority": "high",
        "dueInDays": 70,
        "assigneeId": "tm_ivan"
      },
      {
        "title": "Испытания",
        "status": "todo",
        "priority": "high",
        "dueInDays": 58,
        "assigneeId": "tm_elena"
      },
      {
        "title": "Документация",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 36,
        "assigneeId": "tm_elena"
      }
    ],
    "milestones": [
      {
        "title": "Проект",
        "status": "in_progress",
        "dateOffsetDays": 36,
        "description": "Этап 1"
      },
      {
        "title": "Разрешение",
        "status": "upcoming",
        "dateOffsetDays": 72,
        "description": "Этап 2"
      },
      {
        "title": "Фундамент",
        "status": "upcoming",
        "dateOffsetDays": 107,
        "description": "Этап 3"
      },
      {
        "title": "Каркас",
        "status": "upcoming",
        "dateOffsetDays": 144,
        "description": "Этап 4"
      },
      {
        "title": "Кровля",
        "status": "upcoming",
        "dateOffsetDays": 180,
        "description": "Этап 5"
      }
    ],
    "documents": [
      {
        "title": "Проектная документация",
        "type": "pdf",
        "size": 1303336
      },
      {
        "title": "Смета",
        "type": "xlsx",
        "size": 501109
      },
      {
        "title": "Календарный план",
        "type": "xlsx",
        "size": 299934
      },
      {
        "title": "Договор",
        "type": "docx",
        "size": 257123
      }
    ],
    "risks": [
      {
        "title": "Кредитование",
        "description": "Высокая ставка",
        "probability": "medium",
        "impact": "high",
        "severity": 6,
        "status": "closed",
        "ownerId": "tm_ivan"
      }
    ]
  },
  {
    "id": "proj_018",
    "name": "Логистический хаб «Северный путь»",
    "description": "Региональный хаб для консолидации поставок в северном контуре",
    "status": "planning",
    "direction": "logistics",
    "priority": "critical",
    "health": "good",
    "start": "2025-05-25",
    "end": "2026-03-21",
    "budgetPlan": 23000000,
    "budgetFact": 23000000,
    "progress": 18,
    "location": "Сургут",
    "teamIds": [
      "tm_andrey",
      "tm_natasha",
      "tm_dmitry",
      "tm_sergey",
      "tm_ivan"
    ],
    "tasks": [
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "high",
        "dueInDays": 80,
        "assigneeId": "tm_ivan"
      },
      {
        "title": "Согласование",
        "status": "done",
        "priority": "critical",
        "dueInDays": 24,
        "assigneeId": "tm_sergey"
      },
      {
        "title": "Закупка материалов",
        "status": "in_progress",
        "priority": "critical",
        "dueInDays": 49,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Монтаж",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 63,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Пусконаладка",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 35,
        "assigneeId": "tm_ivan"
      },
      {
        "title": "Сдача объекта",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 34,
        "assigneeId": "tm_sergey"
      },
      {
        "title": "Испытания",
        "status": "todo",
        "priority": "low",
        "dueInDays": 45,
        "assigneeId": "tm_sergey"
      },
      {
        "title": "Документация",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 54,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Подготовка документации",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 9,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Согласование",
        "status": "todo",
        "priority": "high",
        "dueInDays": 17,
        "assigneeId": "tm_sergey"
      },
      {
        "title": "Закупка материалов",
        "status": "todo",
        "priority": "low",
        "dueInDays": 72,
        "assigneeId": "tm_sergey"
      },
      {
        "title": "Монтаж",
        "status": "todo",
        "priority": "low",
        "dueInDays": 23,
        "assigneeId": "tm_sergey"
      }
    ],
    "milestones": [
      {
        "title": "Проект",
        "status": "in_progress",
        "dateOffsetDays": 60,
        "description": "Этап 1"
      },
      {
        "title": "Разрешение",
        "status": "upcoming",
        "dateOffsetDays": 120,
        "description": "Этап 2"
      },
      {
        "title": "Фундамент",
        "status": "upcoming",
        "dateOffsetDays": 180,
        "description": "Этап 3"
      },
      {
        "title": "Каркас",
        "status": "upcoming",
        "dateOffsetDays": 240,
        "description": "Этап 4"
      },
      {
        "title": "Кровля",
        "status": "upcoming",
        "dateOffsetDays": 300,
        "description": "Этап 5"
      }
    ],
    "documents": [
      {
        "title": "Проектная документация",
        "type": "pdf",
        "size": 1323718
      },
      {
        "title": "Смета",
        "type": "xlsx",
        "size": 339231
      },
      {
        "title": "Календарный план",
        "type": "xlsx",
        "size": 446148
      },
      {
        "title": "Договор",
        "type": "docx",
        "size": 169474
      }
    ],
    "risks": [
      {
        "title": "Выбор площадки",
        "description": "Задержка аренды",
        "probability": "medium",
        "impact": "high",
        "severity": 6,
        "status": "mitigated",
        "ownerId": "tm_ivan"
      }
    ]
  },
  {
    "id": "proj_019",
    "name": "Автоцентр KIA «Сургут-Авто»",
    "description": "Строительство дилерского центра с сервисом на 15 постов, склад запчастей",
    "status": "at_risk",
    "direction": "trade",
    "priority": "critical",
    "health": "critical",
    "start": "2025-06-28",
    "end": "2026-08-22",
    "budgetPlan": 100000000,
    "budgetFact": 128000000,
    "progress": 55,
    "location": "Сургут",
    "teamIds": [
      "tm_pavel",
      "tm_dmitry",
      "tm_andrey",
      "tm_natasha",
      "tm_elena",
      "tm_irina"
    ],
    "tasks": [
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "low",
        "dueInDays": 84,
        "assigneeId": "tm_pavel"
      },
      {
        "title": "Согласование",
        "status": "done",
        "priority": "medium",
        "dueInDays": 85,
        "assigneeId": "tm_irina"
      },
      {
        "title": "Закупка материалов",
        "status": "done",
        "priority": "high",
        "dueInDays": 34,
        "assigneeId": "tm_irina"
      },
      {
        "title": "Монтаж",
        "status": "done",
        "priority": "low",
        "dueInDays": 60,
        "assigneeId": "tm_pavel"
      },
      {
        "title": "Пусконаладка",
        "status": "done",
        "priority": "low",
        "dueInDays": 61,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Сдача объекта",
        "status": "done",
        "priority": "high",
        "dueInDays": 8,
        "assigneeId": "tm_pavel"
      },
      {
        "title": "Испытания",
        "status": "done",
        "priority": "high",
        "dueInDays": 12,
        "assigneeId": "tm_andrey"
      },
      {
        "title": "Документация",
        "status": "done",
        "priority": "high",
        "dueInDays": 52,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Подготовка документации",
        "status": "in_progress",
        "priority": "medium",
        "dueInDays": 36,
        "assigneeId": "tm_elena"
      },
      {
        "title": "Согласование",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 77,
        "assigneeId": "tm_irina"
      },
      {
        "title": "Закупка материалов",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 26,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Монтаж",
        "status": "todo",
        "priority": "low",
        "dueInDays": 83,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Пусконаладка",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 68,
        "assigneeId": "tm_elena"
      },
      {
        "title": "Сдача объекта",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 34,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Испытания",
        "status": "todo",
        "priority": "high",
        "dueInDays": 63,
        "assigneeId": "tm_andrey"
      },
      {
        "title": "Документация",
        "status": "todo",
        "priority": "low",
        "dueInDays": 64,
        "assigneeId": "tm_andrey"
      }
    ],
    "milestones": [
      {
        "title": "Проект",
        "status": "completed",
        "dateOffsetDays": 84,
        "description": "Этап 1"
      },
      {
        "title": "Разрешение",
        "status": "completed",
        "dateOffsetDays": 168,
        "description": "Этап 2"
      },
      {
        "title": "Фундамент",
        "status": "in_progress",
        "dateOffsetDays": 252,
        "description": "Этап 3"
      },
      {
        "title": "Каркас",
        "status": "upcoming",
        "dateOffsetDays": 336,
        "description": "Этап 4"
      },
      {
        "title": "Кровля",
        "status": "upcoming",
        "dateOffsetDays": 420,
        "description": "Этап 5"
      }
    ],
    "documents": [
      {
        "title": "Проектная документация",
        "type": "pdf",
        "size": 2146299
      },
      {
        "title": "Смета",
        "type": "xlsx",
        "size": 382824
      },
      {
        "title": "Календарный план",
        "type": "xlsx",
        "size": 238724
      },
      {
        "title": "Договор",
        "type": "docx",
        "size": 215796
      }
    ],
    "risks": [
      {
        "title": "Санкции на автокомпоненты",
        "description": "KIA ушёл из РФ",
        "probability": "high",
        "impact": "critical",
        "severity": 12,
        "status": "mitigated",
        "ownerId": "tm_elena"
      },
      {
        "title": "Параллельный импорт",
        "description": "Сложности с гарантией",
        "probability": "medium",
        "impact": "high",
        "severity": 6,
        "status": "mitigated",
        "ownerId": "tm_irina"
      }
    ]
  },
  {
    "id": "proj_020",
    "name": "Поставка бентонитовых глин из Казахстана",
    "description": "Закупка 30 000 тонн бентонита для буровых растворов",
    "status": "active",
    "direction": "trade",
    "priority": "medium",
    "health": "good",
    "start": "2025-05-15",
    "end": "2026-03-11",
    "budgetPlan": 53000000,
    "budgetFact": 51940000,
    "progress": 70,
    "location": "Астана, Казахстан",
    "teamIds": [
      "tm_sergey",
      "tm_marina",
      "tm_andrey",
      "tm_elena"
    ],
    "tasks": [
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "medium",
        "dueInDays": 53,
        "assigneeId": "tm_andrey"
      },
      {
        "title": "Согласование",
        "status": "done",
        "priority": "high",
        "dueInDays": 42,
        "assigneeId": "tm_sergey"
      },
      {
        "title": "Закупка материалов",
        "status": "done",
        "priority": "critical",
        "dueInDays": 40,
        "assigneeId": "tm_sergey"
      },
      {
        "title": "Монтаж",
        "status": "done",
        "priority": "low",
        "dueInDays": 82,
        "assigneeId": "tm_elena"
      },
      {
        "title": "Пусконаладка",
        "status": "done",
        "priority": "high",
        "dueInDays": 34,
        "assigneeId": "tm_andrey"
      },
      {
        "title": "Сдача объекта",
        "status": "done",
        "priority": "medium",
        "dueInDays": 86,
        "assigneeId": "tm_marina"
      },
      {
        "title": "Испытания",
        "status": "in_progress",
        "priority": "high",
        "dueInDays": 89,
        "assigneeId": "tm_marina"
      },
      {
        "title": "Документация",
        "status": "todo",
        "priority": "low",
        "dueInDays": 85,
        "assigneeId": "tm_sergey"
      },
      {
        "title": "Подготовка документации",
        "status": "todo",
        "priority": "high",
        "dueInDays": 61,
        "assigneeId": "tm_sergey"
      }
    ],
    "milestones": [
      {
        "title": "Проект",
        "status": "completed",
        "dateOffsetDays": 60,
        "description": "Этап 1"
      },
      {
        "title": "Разрешение",
        "status": "completed",
        "dateOffsetDays": 120,
        "description": "Этап 2"
      },
      {
        "title": "Фундамент",
        "status": "in_progress",
        "dateOffsetDays": 180,
        "description": "Этап 3"
      },
      {
        "title": "Каркас",
        "status": "upcoming",
        "dateOffsetDays": 240,
        "description": "Этап 4"
      },
      {
        "title": "Кровля",
        "status": "upcoming",
        "dateOffsetDays": 300,
        "description": "Этап 5"
      }
    ],
    "documents": [
      {
        "title": "Проектная документация",
        "type": "pdf",
        "size": 1765169
      },
      {
        "title": "Смета",
        "type": "xlsx",
        "size": 683967
      },
      {
        "title": "Календарный план",
        "type": "xlsx",
        "size": 268897
      },
      {
        "title": "Договор",
        "type": "docx",
        "size": 123627
      }
    ],
    "risks": [
      {
        "title": "Качество сырья",
        "description": "Несоответствие ГОСТ",
        "probability": "low",
        "impact": "high",
        "severity": 3,
        "status": "mitigated",
        "ownerId": "tm_andrey"
      },
      {
        "title": "Транспортные расходы",
        "description": "ЖД тарифы",
        "probability": "medium",
        "impact": "medium",
        "severity": 4,
        "status": "closed",
        "ownerId": "tm_elena"
      }
    ]
  },
  {
    "id": "proj_021",
    "name": "Продажа инертных материалов (песок, щебень)",
    "description": "Оптовая торговля нерудными материалами, база в Новосибе",
    "status": "active",
    "direction": "trade",
    "priority": "critical",
    "health": "good",
    "start": "2025-03-26",
    "end": "2026-03-21",
    "budgetPlan": 31000000,
    "budgetFact": 31620000,
    "progress": 45,
    "location": "Новосибирск",
    "teamIds": [
      "tm_dmitry",
      "tm_natasha",
      "tm_tatyana",
      "tm_irina",
      "tm_sergey"
    ],
    "tasks": [
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "high",
        "dueInDays": 66,
        "assigneeId": "tm_tatyana"
      },
      {
        "title": "Согласование",
        "status": "done",
        "priority": "high",
        "dueInDays": 19,
        "assigneeId": "tm_irina"
      },
      {
        "title": "Закупка материалов",
        "status": "done",
        "priority": "low",
        "dueInDays": 23,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Монтаж",
        "status": "done",
        "priority": "critical",
        "dueInDays": 76,
        "assigneeId": "tm_tatyana"
      },
      {
        "title": "Пусконаладка",
        "status": "in_progress",
        "priority": "low",
        "dueInDays": 55,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Сдача объекта",
        "status": "todo",
        "priority": "high",
        "dueInDays": 73,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Испытания",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 52,
        "assigneeId": "tm_tatyana"
      },
      {
        "title": "Документация",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 86,
        "assigneeId": "tm_tatyana"
      },
      {
        "title": "Подготовка документации",
        "status": "todo",
        "priority": "low",
        "dueInDays": 34,
        "assigneeId": "tm_irina"
      },
      {
        "title": "Согласование",
        "status": "todo",
        "priority": "low",
        "dueInDays": 84,
        "assigneeId": "tm_sergey"
      }
    ],
    "milestones": [
      {
        "title": "Проект",
        "status": "completed",
        "dateOffsetDays": 90,
        "description": "Этап 1"
      },
      {
        "title": "Разрешение",
        "status": "in_progress",
        "dateOffsetDays": 180,
        "description": "Этап 2"
      },
      {
        "title": "Фундамент",
        "status": "upcoming",
        "dateOffsetDays": 270,
        "description": "Этап 3"
      },
      {
        "title": "Каркас",
        "status": "upcoming",
        "dateOffsetDays": 360,
        "description": "Этап 4"
      }
    ],
    "documents": [
      {
        "title": "Проектная документация",
        "type": "pdf",
        "size": 2919430
      },
      {
        "title": "Смета",
        "type": "xlsx",
        "size": 619858
      },
      {
        "title": "Календарный план",
        "type": "xlsx",
        "size": 316060
      },
      {
        "title": "Договор",
        "type": "docx",
        "size": 269778
      }
    ],
    "risks": [
      {
        "title": "Лицензирование карьеров",
        "description": "Росприроднадзор",
        "probability": "medium",
        "impact": "high",
        "severity": 6,
        "status": "open",
        "ownerId": "tm_irina"
      },
      {
        "title": "Сезонность спроса",
        "description": "Зимний спад",
        "probability": "high",
        "impact": "medium",
        "severity": 6,
        "status": "closed",
        "ownerId": "tm_tatyana"
      }
    ]
  },
  {
    "id": "proj_022",
    "name": "Торговый центр «Мега-Сити»",
    "description": "Строительство ТЦ площадью 45 000 м², 120 арендаторов",
    "status": "at_risk",
    "direction": "construction",
    "priority": "medium",
    "health": "critical",
    "start": "2025-03-02",
    "end": "2027-06-20",
    "budgetPlan": 609000000,
    "budgetFact": 761250000,
    "progress": 65,
    "location": "Санкт-Петербург",
    "teamIds": [
      "tm_ivan",
      "tm_sergey",
      "tm_elena",
      "tm_olga",
      "tm_dmitry",
      "tm_irina",
      "tm_pavel",
      "tm_andrey",
      "tm_marina",
      "tm_natasha",
      "tm_alexey",
      "tm_tatyana"
    ],
    "tasks": [
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "critical",
        "dueInDays": 88,
        "assigneeId": "tm_sergey"
      },
      {
        "title": "Согласование",
        "status": "done",
        "priority": "critical",
        "dueInDays": 83,
        "assigneeId": "tm_pavel"
      },
      {
        "title": "Закупка материалов",
        "status": "done",
        "priority": "high",
        "dueInDays": 9,
        "assigneeId": "tm_tatyana"
      },
      {
        "title": "Монтаж",
        "status": "done",
        "priority": "high",
        "dueInDays": 32,
        "assigneeId": "tm_andrey"
      },
      {
        "title": "Пусконаладка",
        "status": "done",
        "priority": "critical",
        "dueInDays": 35,
        "assigneeId": "tm_irina"
      },
      {
        "title": "Сдача объекта",
        "status": "done",
        "priority": "low",
        "dueInDays": 52,
        "assigneeId": "tm_marina"
      },
      {
        "title": "Испытания",
        "status": "in_progress",
        "priority": "high",
        "dueInDays": 12,
        "assigneeId": "tm_pavel"
      },
      {
        "title": "Документация",
        "status": "todo",
        "priority": "high",
        "dueInDays": 29,
        "assigneeId": "tm_sergey"
      },
      {
        "title": "Подготовка документации",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 16,
        "assigneeId": "tm_alexey"
      },
      {
        "title": "Согласование",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 87,
        "assigneeId": "tm_alexey"
      }
    ],
    "milestones": [
      {
        "title": "Проект",
        "status": "completed",
        "dateOffsetDays": 168,
        "description": "Этап 1"
      },
      {
        "title": "Разрешение",
        "status": "completed",
        "dateOffsetDays": 336,
        "description": "Этап 2"
      },
      {
        "title": "Фундамент",
        "status": "in_progress",
        "dateOffsetDays": 504,
        "description": "Этап 3"
      },
      {
        "title": "Каркас",
        "status": "upcoming",
        "dateOffsetDays": 672,
        "description": "Этап 4"
      },
      {
        "title": "Кровля",
        "status": "upcoming",
        "dateOffsetDays": 840,
        "description": "Этап 5"
      }
    ],
    "documents": [
      {
        "title": "Проектная документация",
        "type": "pdf",
        "size": 1044789
      },
      {
        "title": "Смета",
        "type": "xlsx",
        "size": 326517
      },
      {
        "title": "Календарный план",
        "type": "xlsx",
        "size": 374854
      },
      {
        "title": "Договор",
        "type": "docx",
        "size": 163850
      }
    ],
    "risks": [
      {
        "title": "Критическое отставание",
        "description": "Сроки сорваны на 4 месяца",
        "probability": "high",
        "impact": "critical",
        "severity": 12,
        "status": "open",
        "ownerId": "tm_natasha"
      },
      {
        "title": "Перерасход бюджета",
        "description": "+25% к плану",
        "probability": "high",
        "impact": "critical",
        "severity": 12,
        "status": "open",
        "ownerId": "tm_sergey"
      }
    ]
  },
  {
    "id": "proj_023",
    "name": "CRM продаж «ПромЛайн»",
    "description": "Внедрение CRM для отдела продаж с воронкой и интеграциями",
    "status": "active",
    "direction": "trade",
    "priority": "low",
    "health": "good",
    "start": "2025-04-27",
    "end": "2025-09-24",
    "budgetPlan": 6000000,
    "budgetFact": 5760000,
    "progress": 44,
    "location": "Москва",
    "teamIds": [
      "tm_marina",
      "tm_natasha",
      "tm_alexey"
    ],
    "tasks": [
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "high",
        "dueInDays": 23,
        "assigneeId": "tm_marina"
      },
      {
        "title": "Согласование",
        "status": "done",
        "priority": "high",
        "dueInDays": 27,
        "assigneeId": "tm_marina"
      },
      {
        "title": "Закупка материалов",
        "status": "done",
        "priority": "low",
        "dueInDays": 21,
        "assigneeId": "tm_marina"
      },
      {
        "title": "Монтаж",
        "status": "in_progress",
        "priority": "high",
        "dueInDays": 35,
        "assigneeId": "tm_alexey"
      },
      {
        "title": "Пусконаладка",
        "status": "todo",
        "priority": "high",
        "dueInDays": 7,
        "assigneeId": "tm_marina"
      },
      {
        "title": "Сдача объекта",
        "status": "todo",
        "priority": "high",
        "dueInDays": 11,
        "assigneeId": "tm_marina"
      },
      {
        "title": "Испытания",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 72,
        "assigneeId": "tm_marina"
      },
      {
        "title": "Документация",
        "status": "todo",
        "priority": "low",
        "dueInDays": 65,
        "assigneeId": "tm_natasha"
      }
    ],
    "milestones": [
      {
        "title": "Проект",
        "status": "completed",
        "dateOffsetDays": 37,
        "description": "Этап 1"
      },
      {
        "title": "Разрешение",
        "status": "in_progress",
        "dateOffsetDays": 75,
        "description": "Этап 2"
      },
      {
        "title": "Фундамент",
        "status": "upcoming",
        "dateOffsetDays": 112,
        "description": "Этап 3"
      },
      {
        "title": "Каркас",
        "status": "upcoming",
        "dateOffsetDays": 150,
        "description": "Этап 4"
      }
    ],
    "documents": [
      {
        "title": "Проектная документация",
        "type": "pdf",
        "size": 2076338
      },
      {
        "title": "Смета",
        "type": "xlsx",
        "size": 611251
      },
      {
        "title": "Календарный план",
        "type": "xlsx",
        "size": 257175
      },
      {
        "title": "Договор",
        "type": "docx",
        "size": 218490
      }
    ],
    "risks": [
      {
        "title": "Сопротивление менеджеров",
        "description": "Нежелание учиться",
        "probability": "medium",
        "impact": "medium",
        "severity": 4,
        "status": "closed",
        "ownerId": "tm_marina"
      }
    ]
  },
  {
    "id": "proj_024",
    "name": "Переработка дунита ЧЭМК - опытная партия",
    "description": "Извлечение полезных компонентов из дунитовых отвалов, 10 000 м³, Харп",
    "status": "planning",
    "direction": "metallurgy",
    "priority": "critical",
    "health": "warning",
    "start": "2025-08-21",
    "end": "2026-04-18",
    "budgetPlan": 54000000,
    "budgetFact": 54000000,
    "progress": 20,
    "location": "Салехард",
    "teamIds": [
      "tm_ivan",
      "tm_tatyana",
      "tm_elena",
      "tm_andrey",
      "tm_dmitry",
      "tm_natasha"
    ],
    "tasks": [
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "critical",
        "dueInDays": 61,
        "assigneeId": "tm_ivan"
      },
      {
        "title": "Согласование",
        "status": "in_progress",
        "priority": "low",
        "dueInDays": 46,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Закупка материалов",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 13,
        "assigneeId": "tm_tatyana"
      },
      {
        "title": "Монтаж",
        "status": "todo",
        "priority": "high",
        "dueInDays": 84,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Пусконаладка",
        "status": "todo",
        "priority": "high",
        "dueInDays": 53,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Сдача объекта",
        "status": "todo",
        "priority": "high",
        "dueInDays": 63,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Испытания",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 17,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Документация",
        "status": "todo",
        "priority": "low",
        "dueInDays": 88,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Подготовка документации",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 60,
        "assigneeId": "tm_andrey"
      }
    ],
    "milestones": [
      {
        "title": "Проект",
        "status": "upcoming",
        "dateOffsetDays": 80,
        "description": "Этап 1"
      },
      {
        "title": "Разрешение",
        "status": "upcoming",
        "dateOffsetDays": 160,
        "description": "Этап 2"
      },
      {
        "title": "Фундамент",
        "status": "upcoming",
        "dateOffsetDays": 240,
        "description": "Этап 3"
      }
    ],
    "documents": [
      {
        "title": "Проектная документация",
        "type": "pdf",
        "size": 1867829
      },
      {
        "title": "Смета",
        "type": "xlsx",
        "size": 477697
      },
      {
        "title": "Календарный план",
        "type": "xlsx",
        "size": 437764
      },
      {
        "title": "Договор",
        "type": "docx",
        "size": 204524
      }
    ],
    "risks": [
      {
        "title": "Технологические риски",
        "description": "Новое производство",
        "probability": "medium",
        "impact": "high",
        "severity": 6,
        "status": "mitigated",
        "ownerId": "tm_natasha"
      },
      {
        "title": "Оформление лицензии",
        "description": "Недропользование",
        "probability": "high",
        "impact": "critical",
        "severity": 12,
        "status": "open",
        "ownerId": "tm_elena"
      }
    ]
  },
  {
    "id": "proj_025",
    "name": "Установка видеонаблюдения в офисе",
    "description": "Монтаж 24 камер, СКУД, интеграция с охраной",
    "status": "completed",
    "direction": "construction",
    "priority": "medium",
    "health": "good",
    "start": "2025-11-09",
    "end": "2025-12-09",
    "budgetPlan": 2000000,
    "budgetFact": 1840000,
    "progress": 100,
    "location": "Москва",
    "teamIds": [
      "tm_natasha",
      "tm_alexey"
    ],
    "tasks": [
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "low",
        "dueInDays": 16,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Согласование",
        "status": "done",
        "priority": "low",
        "dueInDays": 60,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Закупка материалов",
        "status": "done",
        "priority": "high",
        "dueInDays": 21,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Монтаж",
        "status": "done",
        "priority": "high",
        "dueInDays": 90,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Пусконаладка",
        "status": "done",
        "priority": "critical",
        "dueInDays": 50,
        "assigneeId": "tm_alexey"
      },
      {
        "title": "Сдача объекта",
        "status": "done",
        "priority": "low",
        "dueInDays": 41,
        "assigneeId": "tm_alexey"
      },
      {
        "title": "Испытания",
        "status": "done",
        "priority": "high",
        "dueInDays": 18,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Документация",
        "status": "done",
        "priority": "medium",
        "dueInDays": 89,
        "assigneeId": "tm_alexey"
      },
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "medium",
        "dueInDays": 18,
        "assigneeId": "tm_alexey"
      },
      {
        "title": "Согласование",
        "status": "done",
        "priority": "high",
        "dueInDays": 19,
        "assigneeId": "tm_alexey"
      },
      {
        "title": "Закупка материалов",
        "status": "done",
        "priority": "medium",
        "dueInDays": 59,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Монтаж",
        "status": "done",
        "priority": "high",
        "dueInDays": 8,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Пусконаладка",
        "status": "done",
        "priority": "high",
        "dueInDays": 44,
        "assigneeId": "tm_alexey"
      },
      {
        "title": "Сдача объекта",
        "status": "done",
        "priority": "high",
        "dueInDays": 5,
        "assigneeId": "tm_natasha"
      },
      {
        "title": "Испытания",
        "status": "in_progress",
        "priority": "medium",
        "dueInDays": 77,
        "assigneeId": "tm_alexey"
      }
    ],
    "milestones": [
      {
        "title": "Проект",
        "status": "completed",
        "dateOffsetDays": 10,
        "description": "Этап 1"
      },
      {
        "title": "Разрешение",
        "status": "completed",
        "dateOffsetDays": 20,
        "description": "Этап 2"
      },
      {
        "title": "Фундамент",
        "status": "in_progress",
        "dateOffsetDays": 30,
        "description": "Этап 3"
      }
    ],
    "documents": [
      {
        "title": "Проектная документация",
        "type": "pdf",
        "size": 1297532
      },
      {
        "title": "Смета",
        "type": "xlsx",
        "size": 688481
      },
      {
        "title": "Календарный план",
        "type": "xlsx",
        "size": 216073
      },
      {
        "title": "Договор",
        "type": "docx",
        "size": 124053
      }
    ],
    "risks": []
  },
  {
    "id": "proj_026",
    "name": "Строительство распределительного центра «Восток»",
    "description": "Строительство склада класса A с приёмкой и кросс-доком",
    "status": "active",
    "direction": "construction",
    "priority": "medium",
    "health": "good",
    "start": "2025-07-15",
    "end": "2026-06-10",
    "budgetPlan": 76000000,
    "budgetFact": 80560000,
    "progress": 56,
    "location": "Санкт-Петербург",
    "teamIds": [
      "tm_natasha",
      "tm_alexey",
      "tm_tatyana",
      "tm_sergey",
      "tm_irina",
      "tm_andrey",
      "tm_dmitry"
    ],
    "tasks": [
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "low",
        "dueInDays": 24,
        "assigneeId": "tm_alexey"
      },
      {
        "title": "Согласование",
        "status": "done",
        "priority": "low",
        "dueInDays": 15,
        "assigneeId": "tm_tatyana"
      },
      {
        "title": "Закупка материалов",
        "status": "done",
        "priority": "critical",
        "dueInDays": 89,
        "assigneeId": "tm_sergey"
      },
      {
        "title": "Монтаж",
        "status": "done",
        "priority": "critical",
        "dueInDays": 82,
        "assigneeId": "tm_sergey"
      },
      {
        "title": "Пусконаладка",
        "status": "done",
        "priority": "critical",
        "dueInDays": 39,
        "assigneeId": "tm_alexey"
      },
      {
        "title": "Сдача объекта",
        "status": "in_progress",
        "priority": "low",
        "dueInDays": 49,
        "assigneeId": "tm_sergey"
      },
      {
        "title": "Испытания",
        "status": "todo",
        "priority": "low",
        "dueInDays": 41,
        "assigneeId": "tm_andrey"
      },
      {
        "title": "Документация",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 72,
        "assigneeId": "tm_andrey"
      },
      {
        "title": "Подготовка документации",
        "status": "todo",
        "priority": "high",
        "dueInDays": 10,
        "assigneeId": "tm_alexey"
      }
    ],
    "milestones": [
      {
        "title": "Проект",
        "status": "completed",
        "dateOffsetDays": 82,
        "description": "Этап 1"
      },
      {
        "title": "Разрешение",
        "status": "in_progress",
        "dateOffsetDays": 165,
        "description": "Этап 2"
      },
      {
        "title": "Фундамент",
        "status": "upcoming",
        "dateOffsetDays": 247,
        "description": "Этап 3"
      },
      {
        "title": "Каркас",
        "status": "upcoming",
        "dateOffsetDays": 330,
        "description": "Этап 4"
      }
    ],
    "documents": [
      {
        "title": "Проектная документация",
        "type": "pdf",
        "size": 2256875
      },
      {
        "title": "Смета",
        "type": "xlsx",
        "size": 328721
      },
      {
        "title": "Календарный план",
        "type": "xlsx",
        "size": 204030
      },
      {
        "title": "Договор",
        "type": "docx",
        "size": 153588
      }
    ],
    "risks": [
      {
        "title": "Рост стоимости металла",
        "description": "Цена металлокаркаса",
        "probability": "medium",
        "impact": "high",
        "severity": 6,
        "status": "mitigated",
        "ownerId": "tm_alexey"
      }
    ]
  },
  {
    "id": "proj_027",
    "name": "Газификация пос. Берёзовый",
    "description": "Строительство газопровода высокого давления 12 км, ГРП",
    "status": "active",
    "direction": "construction",
    "priority": "medium",
    "health": "warning",
    "start": "2025-05-11",
    "end": "2026-01-06",
    "budgetPlan": 56000000,
    "budgetFact": 62160000,
    "progress": 48,
    "location": "Тюмень",
    "teamIds": [
      "tm_olga",
      "tm_ivan",
      "tm_elena",
      "tm_andrey",
      "tm_alexey",
      "tm_tatyana"
    ],
    "tasks": [
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "medium",
        "dueInDays": 69,
        "assigneeId": "tm_alexey"
      },
      {
        "title": "Согласование",
        "status": "done",
        "priority": "high",
        "dueInDays": 14,
        "assigneeId": "tm_andrey"
      },
      {
        "title": "Закупка материалов",
        "status": "done",
        "priority": "low",
        "dueInDays": 60,
        "assigneeId": "tm_olga"
      },
      {
        "title": "Монтаж",
        "status": "done",
        "priority": "critical",
        "dueInDays": 14,
        "assigneeId": "tm_elena"
      },
      {
        "title": "Пусконаладка",
        "status": "done",
        "priority": "critical",
        "dueInDays": 78,
        "assigneeId": "tm_andrey"
      },
      {
        "title": "Сдача объекта",
        "status": "done",
        "priority": "critical",
        "dueInDays": 42,
        "assigneeId": "tm_olga"
      },
      {
        "title": "Испытания",
        "status": "in_progress",
        "priority": "critical",
        "dueInDays": 7,
        "assigneeId": "tm_elena"
      },
      {
        "title": "Документация",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 84,
        "assigneeId": "tm_andrey"
      },
      {
        "title": "Подготовка документации",
        "status": "todo",
        "priority": "high",
        "dueInDays": 16,
        "assigneeId": "tm_andrey"
      },
      {
        "title": "Согласование",
        "status": "todo",
        "priority": "low",
        "dueInDays": 36,
        "assigneeId": "tm_andrey"
      },
      {
        "title": "Закупка материалов",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 72,
        "assigneeId": "tm_olga"
      },
      {
        "title": "Монтаж",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 44,
        "assigneeId": "tm_tatyana"
      },
      {
        "title": "Пусконаладка",
        "status": "todo",
        "priority": "high",
        "dueInDays": 33,
        "assigneeId": "tm_elena"
      },
      {
        "title": "Сдача объекта",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 14,
        "assigneeId": "tm_alexey"
      }
    ],
    "milestones": [
      {
        "title": "Проект",
        "status": "completed",
        "dateOffsetDays": 48,
        "description": "Этап 1"
      },
      {
        "title": "Разрешение",
        "status": "in_progress",
        "dateOffsetDays": 96,
        "description": "Этап 2"
      },
      {
        "title": "Фундамент",
        "status": "upcoming",
        "dateOffsetDays": 144,
        "description": "Этап 3"
      },
      {
        "title": "Каркас",
        "status": "upcoming",
        "dateOffsetDays": 192,
        "description": "Этап 4"
      },
      {
        "title": "Кровля",
        "status": "upcoming",
        "dateOffsetDays": 240,
        "description": "Этап 5"
      }
    ],
    "documents": [
      {
        "title": "Проектная документация",
        "type": "pdf",
        "size": 1239131
      },
      {
        "title": "Смета",
        "type": "xlsx",
        "size": 578189
      },
      {
        "title": "Календарный план",
        "type": "xlsx",
        "size": 467361
      },
      {
        "title": "Договор",
        "type": "docx",
        "size": 150830
      }
    ],
    "risks": [
      {
        "title": "Согласование с газовиками",
        "description": "Техусловия",
        "probability": "high",
        "impact": "high",
        "severity": 9,
        "status": "mitigated",
        "ownerId": "tm_elena"
      }
    ]
  },
  {
    "id": "proj_028",
    "name": "Строительство автосервисного центра",
    "description": "Сервис на 20 постов, шиномонтаж, автомойка",
    "status": "planning",
    "direction": "construction",
    "priority": "medium",
    "health": "good",
    "start": "2025-02-05",
    "end": "2025-11-02",
    "budgetPlan": 41000000,
    "budgetFact": 41000000,
    "progress": 8,
    "location": "Новосибирск",
    "teamIds": [
      "tm_sergey",
      "tm_marina",
      "tm_alexey",
      "tm_irina",
      "tm_olga",
      "tm_elena"
    ],
    "tasks": [
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "critical",
        "dueInDays": 77,
        "assigneeId": "tm_olga"
      },
      {
        "title": "Согласование",
        "status": "in_progress",
        "priority": "critical",
        "dueInDays": 77,
        "assigneeId": "tm_elena"
      },
      {
        "title": "Закупка материалов",
        "status": "todo",
        "priority": "high",
        "dueInDays": 85,
        "assigneeId": "tm_alexey"
      },
      {
        "title": "Монтаж",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 61,
        "assigneeId": "tm_sergey"
      },
      {
        "title": "Пусконаладка",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 61,
        "assigneeId": "tm_elena"
      },
      {
        "title": "Сдача объекта",
        "status": "todo",
        "priority": "high",
        "dueInDays": 40,
        "assigneeId": "tm_olga"
      },
      {
        "title": "Испытания",
        "status": "todo",
        "priority": "low",
        "dueInDays": 50,
        "assigneeId": "tm_olga"
      },
      {
        "title": "Документация",
        "status": "todo",
        "priority": "low",
        "dueInDays": 44,
        "assigneeId": "tm_irina"
      },
      {
        "title": "Подготовка документации",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 9,
        "assigneeId": "tm_sergey"
      },
      {
        "title": "Согласование",
        "status": "todo",
        "priority": "high",
        "dueInDays": 41,
        "assigneeId": "tm_sergey"
      },
      {
        "title": "Закупка материалов",
        "status": "todo",
        "priority": "low",
        "dueInDays": 83,
        "assigneeId": "tm_olga"
      },
      {
        "title": "Монтаж",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 64,
        "assigneeId": "tm_olga"
      },
      {
        "title": "Пусконаладка",
        "status": "todo",
        "priority": "low",
        "dueInDays": 62,
        "assigneeId": "tm_olga"
      },
      {
        "title": "Сдача объекта",
        "status": "todo",
        "priority": "medium",
        "dueInDays": 46,
        "assigneeId": "tm_olga"
      },
      {
        "title": "Испытания",
        "status": "todo",
        "priority": "critical",
        "dueInDays": 69,
        "assigneeId": "tm_marina"
      }
    ],
    "milestones": [
      {
        "title": "Проект",
        "status": "upcoming",
        "dateOffsetDays": 90,
        "description": "Этап 1"
      },
      {
        "title": "Разрешение",
        "status": "upcoming",
        "dateOffsetDays": 180,
        "description": "Этап 2"
      },
      {
        "title": "Фундамент",
        "status": "upcoming",
        "dateOffsetDays": 270,
        "description": "Этап 3"
      }
    ],
    "documents": [
      {
        "title": "Проектная документация",
        "type": "pdf",
        "size": 1944815
      },
      {
        "title": "Смета",
        "type": "xlsx",
        "size": 354264
      },
      {
        "title": "Календарный план",
        "type": "xlsx",
        "size": 380060
      },
      {
        "title": "Договор",
        "type": "docx",
        "size": 287253
      }
    ],
    "risks": [
      {
        "title": "Земельный участок",
        "description": "Зонирование",
        "probability": "medium",
        "impact": "high",
        "severity": 6,
        "status": "open",
        "ownerId": "tm_olga"
      }
    ]
  },
  {
    "id": "proj_029",
    "name": "Модернизация системы освещения завода",
    "description": "Замена светильников на LED, 1500 точек, экономия 40% электроэнергии",
    "status": "completed",
    "direction": "construction",
    "priority": "low",
    "health": "good",
    "start": "2025-04-23",
    "end": "2025-07-22",
    "budgetPlan": 12000000,
    "budgetFact": 11520000,
    "progress": 100,
    "location": "Тюмень",
    "teamIds": [
      "tm_elena",
      "tm_tatyana",
      "tm_dmitry",
      "tm_irina"
    ],
    "tasks": [
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "high",
        "dueInDays": 52,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Согласование",
        "status": "done",
        "priority": "critical",
        "dueInDays": 57,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Закупка материалов",
        "status": "done",
        "priority": "low",
        "dueInDays": 85,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Монтаж",
        "status": "done",
        "priority": "low",
        "dueInDays": 47,
        "assigneeId": "tm_elena"
      },
      {
        "title": "Пусконаладка",
        "status": "done",
        "priority": "critical",
        "dueInDays": 41,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Сдача объекта",
        "status": "done",
        "priority": "medium",
        "dueInDays": 47,
        "assigneeId": "tm_elena"
      },
      {
        "title": "Испытания",
        "status": "done",
        "priority": "medium",
        "dueInDays": 49,
        "assigneeId": "tm_dmitry"
      },
      {
        "title": "Документация",
        "status": "done",
        "priority": "critical",
        "dueInDays": 21,
        "assigneeId": "tm_elena"
      },
      {
        "title": "Подготовка документации",
        "status": "done",
        "priority": "high",
        "dueInDays": 76,
        "assigneeId": "tm_irina"
      },
      {
        "title": "Согласование",
        "status": "in_progress",
        "priority": "high",
        "dueInDays": 21,
        "assigneeId": "tm_elena"
      }
    ],
    "milestones": [
      {
        "title": "Проект",
        "status": "completed",
        "dateOffsetDays": 18,
        "description": "Этап 1"
      },
      {
        "title": "Разрешение",
        "status": "completed",
        "dateOffsetDays": 36,
        "description": "Этап 2"
      },
      {
        "title": "Фундамент",
        "status": "completed",
        "dateOffsetDays": 53,
        "description": "Этап 3"
      },
      {
        "title": "Каркас",
        "status": "completed",
        "dateOffsetDays": 72,
        "description": "Этап 4"
      },
      {
        "title": "Кровля",
        "status": "in_progress",
        "dateOffsetDays": 90,
        "description": "Этап 5"
      }
    ],
    "documents": [
      {
        "title": "Проектная документация",
        "type": "pdf",
        "size": 2406048
      },
      {
        "title": "Смета",
        "type": "xlsx",
        "size": 521986
      },
      {
        "title": "Календарный план",
        "type": "xlsx",
        "size": 466594
      },
      {
        "title": "Договор",
        "type": "docx",
        "size": 194851
      }
    ],
    "risks": []
  }
];

async function main() {
  console.log("🌱 Seeding demo projects...");

  // Create or find team members
  const teamMemberCache: Record<string, string> = {};

  for (const project of projects) {
    // Ensure team members exist
    for (const teamMemberId of project.teamIds) {
      if (!teamMemberCache[teamMemberId]) {
        const existing = await prisma.teamMember.findFirst({
          where: { id: teamMemberId }
        });

        if (existing) {
          teamMemberCache[teamMemberId] = existing.id;
        } else {
          // Find member data from a predefined list or create a basic one
          const memberNames: Record<string, {name: string, role: string, initials: string}> = {
            tm_ivan: { name: "Иван Петров", role: "Руководитель проекта", initials: "ИП" },
            tm_olga: { name: "Ольга Сидорова", role: "Финансовый директор", initials: "ОС" },
            tm_alexey: { name: "Алексей Козлов", role: "Инженер ПТО", initials: "АК" },
            tm_marina: { name: "Марина Новикова", role: "Юрист", initials: "МН" },
            tm_sergey: { name: "Сергей Волков", role: "Логист", initials: "СВ" },
            tm_natasha: { name: "Наталья Морозова", role: "Бухгалтер", initials: "НМ" },
            tm_andrey: { name: "Андрей Соколов", role: "Прораб", initials: "АС" },
            tm_elena: { name: "Елена Кузнецова", role: "Менеджер по закупкам", initials: "ЕК" },
            tm_dmitry: { name: "Дмитрий Федоров", role: "Геодезист", initials: "ДФ" },
            tm_irina: { name: "Ирина Белова", role: "HR директор", initials: "ИБ" },
            tm_pavel: { name: "Павел Ильин", role: "Снабженец", initials: "ПИ" },
            tm_tatyana: { name: "Татьяна Романова", role: "Архитектор", initials: "ТР" },
          };

          const memberData = memberNames[teamMemberId] || {
            name: teamMemberId,
            role: "Сотрудник",
            initials: "??"
          };

          const created = await prisma.teamMember.create({
            data: {
              id: teamMemberId,
              name: memberData.name,
              role: memberData.role,
              initials: memberData.initials,
              email: `${teamMemberId}@demo.ru`,
            }
          });
          teamMemberCache[teamMemberId] = created.id;
        }
      }
    }

    // Create project
    console.log(`Creating project: ${project.name}`);

    const createdProject = await prisma.project.create({
      data: {
        id: project.id,
        name: project.name,
        description: project.description,
        status: project.status,
        direction: project.direction,
        priority: project.priority,
        health: project.health,
        start: new Date(project.start),
        end: new Date(project.end),
        budgetPlan: project.budgetPlan,
        budgetFact: project.budgetFact,
        progress: project.progress,
        location: project.location,
        team: {
          connect: project.teamIds.map((id: string) => ({ id }))
        }
      }
    });

    // Create board
    const board = await prisma.board.create({
      data: {
        id: `board_${project.id}`,
        name: `Доска: ${project.name}`,
        projectId: createdProject.id,
        updatedAt: new Date(),
        columns: {
          create: [
            { id: `col_${project.id}_0`, title: "К выполнению", order: 0, color: "#6B7280" },
            { id: `col_${project.id}_1`, title: "В работе", order: 1, color: "#3B82F6" },
            { id: `col_${project.id}_2`, title: "На проверке", order: 2, color: "#F59E0B" },
            { id: `col_${project.id}_3`, title: "Готово", order: 3, color: "#10B981" },
          ]
        }
      },
      include: { columns: true }
    });

    const columnMap: Record<string, string> = {};
    board.columns.forEach(col => {
      columnMap[col.title] = col.id;
    });

    // Create tasks
    for (const task of project.tasks) {
      await prisma.task.create({
        data: {
          title: task.title,
          status: task.status,
          priority: task.priority,
          dueDate: addDays(project.start, task.dueInDays),
          projectId: createdProject.id,
          assigneeId: task.assigneeId,
          columnId: columnMap[task.columnTitle] || columnMap["К выполнению"],
        }
      });
    }

    // Create milestones
    for (const milestone of project.milestones) {
      await prisma.milestone.create({
        data: {
          title: milestone.title,
          description: milestone.description,
          status: milestone.status,
          date: addDays(project.start, milestone.dateOffsetDays),
          projectId: createdProject.id,
        }
      });
    }

    // Create documents
    for (const doc of project.documents) {
      await prisma.document.create({
        data: {
          title: doc.title,
          type: doc.type,
          size: doc.size,
          projectId: createdProject.id,
        }
      });
    }

    // Create risks
    for (const risk of project.risks) {
      await prisma.risk.create({
        data: {
          title: risk.title,
          description: risk.description,
          probability: risk.probability,
          impact: risk.impact,
          severity: risk.severity,
          status: risk.status,
          projectId: createdProject.id,
          ownerId: risk.ownerId,
        }
      });
    }
  }

  console.log("✅ Seeding complete!");
}

main()
  .catch((e) => {
    console.error("❌ Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
