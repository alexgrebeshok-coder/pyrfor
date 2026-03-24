import { parseCommand } from "../intent-parser";

const testCases = [
  { text: "Добавь задачу в ЧЭМК — согласовать СП", intent: "createTask" },
  { text: "Покажи список проектов", intent: "listProjects" },
  { text: "Статус ЧЭМК", intent: "showStatus" },
];

testCases.forEach(({ text, intent }) => {
  const result = parseCommand(text);
  console.log(`Text: "${text}" → Expected: ${intent}, Actual: ${result.intent}`);
});
