"use strict";
const {ROOTS,LEGACY_ROOTS}=require("./paths.js");
const {VaultError:NoteWriteError}=require("./errors.js");
const {newDocument}=require("./document.js");
const {localCreation}=require("./time.js");
const WORK_STATES = Object.freeze({ not_started: "待开始", in_progress: "进行中", paused: "暂停", completed: "已完成", cancelled: "已取消" });

function segment(value, label = "名称") {
  if (typeof value !== "string" || !value.trim()) throw new NoteWriteError("REQUIRED", `请填写${label}。`);
  const name = value.trim();
  if (name.startsWith(".") || /[\u0000-\u001f<>:"/\\|?*#\[\]^]/.test(name) || /[. ]$/.test(name)
    || ["tmp", "node_modules", "项目", "任务"].includes(name.toLowerCase()) || Array.from(name).length > 80) throw new NoteWriteError("INVALID_NAME", `${label}含保留字符、保留名称或超过 80 个字，请修改。`);
  return name;
}

function projectDirectory({ name }) {
  return `${ROOTS.projects}/${segment(name, "项目名称")}`;
}

function workMetadata(notePath, fields) {
  if (!fields || !["project", "task"].includes(fields.type)) return null;
  const parts = notePath.split("/");
  if (fields.type === "project") {
    const active = parts[0] === ROOTS.projects && parts.length === 3;
    const archived = parts[0] === ROOTS.archives && parts[1] === "项目" && parts.length === 4;
    const legacy = parts[0] === LEGACY_ROOTS.areas && parts.at(-3) === "项目" && parts.length >= 5;
    if (parts.at(-1) !== "项目说明.md" || !active && !archived && !legacy) return null;
    return { type: "project", path: notePath, projectPath: notePath, directory: parts.slice(0, -1).join("/"), archived, legacy, test_fixture: fields.test_fixture === true,
      area: typeof fields.area === "string" ? fields.area : legacy ? parts[1] : "",
      group: typeof fields.group === "string" ? fields.group : legacy ? parts.slice(2, -3).join("/") : "",
      directions: Array.isArray(fields.directions) ? fields.directions.filter(value => typeof value === "string") : [],
      title: typeof fields.title === "string" ? fields.title : parts.at(-2), status: fields.status, statusLabel: WORK_STATES[fields.status] || "项目状态缺失或无效" };
  }
  if (parts.at(-1) !== "任务说明.md") return null;
  const independent = parts[0] === LEGACY_ROOTS.independent && parts.length === 3;
  const projectPath = parts.slice(0, -3).concat("项目说明.md").join("/");
  const project = !independent && parts.at(-3) === "任务" ? workMetadata(projectPath, { type: "project" }) : null;
  if (!independent && !project) return null;
  return { type: "task", path: notePath, directory: parts.slice(0, -1).join("/"), projectPath: independent ? "" : projectPath, archived: Boolean(project?.archived), legacy: independent || Boolean(project?.legacy), test_fixture: fields.test_fixture === true,
    area: project?.area || "", group: project?.group || "", title: typeof fields.title === "string" ? fields.title : parts.at(-2),
    status: fields.status, statusLabel: WORK_STATES[fields.status] || "任务状态缺失或无效",
    progress: typeof fields.progress === "string" ? fields.progress : "", next_step: typeof fields.next_step === "string" ? fields.next_step : "",
    warning: typeof fields.progress !== "string" || typeof fields.next_step !== "string" ? "进度或下一步缺失／格式无效，请核对原笔记。" : "" };
}

function goalText(goal, label) {
  if (typeof goal !== "string" || !goal.trim()) throw new NoteWriteError("REQUIRED", `请填写${label}。`);
  return goal.trim();
}

function prepareProject({ name, goal, timezone, area = "", group = "", company = "", directions = [], direction = "" }, now, id) {
  const title = segment(name, "项目名称"), directory = projectDirectory({ name });
  const result = goalText(goal, "项目的目标与范围");
  const fields = { type: "project", title, status: "not_started", ...localCreation(now, timezone), id };
  for (const [key, value] of Object.entries({ area, group, company })) {
    if (typeof value !== "string") throw new NoteWriteError("INVALID_FIELD", `${key} 必须为文字。`);
    if (value.trim()) fields[key] = value.trim();
  }
  if (!Array.isArray(directions) || directions.some(value => typeof value !== "string")) throw new NoteWriteError("INVALID_FIELD", "directions 必须为文字数组。");
  if (typeof direction !== "string") throw new NoteWriteError("INVALID_FIELD", "direction 必须为文字。");
  const values = [...new Set([...directions, direction].map(value => value.trim()).filter(Boolean))];
  if (values.length) fields.directions = values;
  return { directory, path: `${directory}/项目说明.md`, document: newDocument(fields, `# ${title}\n\n## 目标与范围\n\n${result}\n\n## 背景与相关资料\n\n## 成果与用途\n`) };
}

async function prepareTask(files, { name, goal, projectPath = "", timezone }, now, id) {
  const title = segment(name, "任务名称");
  goal = goalText(goal, "任务的预期结果");
  if (!projectPath) throw new NoteWriteError("PROJECT_REQUIRED", "新任务必须选择所属项目。");
  const {documentParts}=require("./document.js");
  const project=workMetadata(projectPath,documentParts(await files.read(projectPath)).fields);
  if (project?.type !== "project") throw new NoteWriteError("INVALID_PROJECT", "所选项目说明不存在或无效。");
  if (project.archived) throw new NoteWriteError("ARCHIVED_PROJECT", "请先恢复项目，再新增任务。");
  if (project.legacy) throw new NoteWriteError("LEGACY_WRITE", "请先迁移项目到 1.项目，再新增任务。");
  const parent=`${project.directory}/任务`;
  const directory=`${parent}/${title}`;
  const fields={type:"task",title,status:"not_started",progress:"",next_step:"",...localCreation(now,timezone),id};
  return { directory, path:`${directory}/任务说明.md`, document:newDocument(fields,`# ${title}\n\n## 预期结果\n\n${goal}\n\n## 背景与相关资料\n\n## 执行过程\n\n## 结果\n`) };
}
module.exports={WORK_STATES,segment,projectDirectory,workMetadata,prepareProject,prepareTask};
