// pi-fleet web 控制台前端逻辑
const ws = new WebSocket(`ws://${location.host}`);
const $ = (id) => document.getElementById(id);
let currentNode = null;
let nodes = [];

function send(obj) { ws.send(JSON.stringify(obj)); }

function statusOnline(on) {
	$("status-dot").classList.toggle("online", on);
}

function renderNodes() {
	const box = $("nodes");
	box.innerHTML = "";
	nodes.forEach((n) => {
		const el = document.createElement("div");
		el.className = "node" + (currentNode === n.id ? " active" : "");
		const isPi = n.adapter === "pi-rpc";
		el.innerHTML = `
			<div class="name"><span class="dot"></span>${n.id}</div>
			<div class="meta">${n.adapter} · ${n.host || n.url || "local"}</div>`;
		el.onclick = () => selectNode(n.id);
		box.appendChild(el);
	});
}

function selectNode(id) {
	currentNode = id;
	const node = nodes.find((n) => n.id === id);
	renderNodes();
	const isPi = node.adapter === "pi-rpc";
	const placeholder = isPi
		? `<div class="panel-header"><div class="title">${id}</div><div class="sub">远程 pi · ${node.host} · 直接对话</div></div>
		   <div id="content"></div>
		   <div id="inputbar">
		     <button class="secondary" id="ctx-btn">📋 上下文</button>
		     <input id="msg-input" placeholder="给 ${id} 的远程 pi 发消息…" />
		     <button id="send-btn">发送</button>
		   </div>`
		: `<div class="panel-header"><div class="title">${id}</div><div class="sub">shell · ${node.host || "local"} · 直接跑命令</div></div>
		   <div id="content"></div>
		   <div id="inputbar">
		     <input id="msg-input" placeholder="在 ${id} 上跑命令… (如 uptime)" />
		     <button id="send-btn">运行</button>
		   </div>`;
	$("panel").innerHTML = placeholder;
	const input = $("msg-input");
	const btn = $("send-btn");
	btn.onclick = submit;
	input.onkeydown = (e) => { if (e.key === "Enter") submit(); };
	if (isPi) {
		$("ctx-btn").onclick = () => { send({ type: "context", node: id }); busy("拉取上下文…"); };
	}
	input.focus();
}

function addMsg(role, body, cls) {
	const content = $("content");
	if (!content) return;
	const div = document.createElement("div");
	div.className = "msg " + (cls || role);
	const roleLabel = { user: "你", assistant: id_label(), tool: "工具" }[role] || role;
	div.innerHTML = `<div class="role">${roleLabel}</div><div class="body"></div>`;
	div.querySelector(".body").textContent = body;
	content.appendChild(div);
	content.scrollTop = content.scrollHeight;
	return div;
}
function id_label() { return currentNode; }

function busy(text) {
	const content = $("content");
	if (!content) return;
	let b = content.querySelector(".busy");
	if (!b) {
		b = document.createElement("div");
		b.className = "busy";
		content.appendChild(b);
	}
	b.textContent = text;
	content.scrollTop = content.scrollHeight;
}
function clearBusy() {
	const content = $("content");
	const b = content?.querySelector(".busy");
	if (b) b.remove();
}

function submit() {
	const input = $("msg-input");
	const text = input.value.trim();
	if (!text || !currentNode) return;
	const node = nodes.find((n) => n.id === currentNode);
	input.value = "";
	if (node.adapter === "pi-rpc") {
		addMsg("user", text);
		send({ type: "prompt", node: currentNode, message: text });
		busy(`${currentNode} 思考中…`);
	} else {
		addMsg("tool", `$ ${text}`);
		send({ type: "exec", node: currentNode, cmd: text });
		busy(`${currentNode} 执行中…`);
	}
}

ws.onopen = () => { statusOnline(true); send({ type: "list" }); };
ws.onclose = () => { statusOnline(false); $("count").textContent = "已断开"; };
ws.onerror = () => { $("count").textContent = "连接错误"; };

ws.onmessage = (e) => {
	const m = JSON.parse(e.data);
	if (m.type === "nodes") {
		nodes = m.nodes;
		$("count").textContent = `${nodes.length} 个节点`;
		renderNodes();
	} else if (m.type === "exec_output") {
		// 流式输出追加到最后一个 tool msg
		const content = $("content");
		let last = content?.querySelector(".msg.tool:last-child .body");
		if (last) last.textContent += m.chunk;
	} else if (m.type === "exec_done") {
		clearBusy();
		if (m.exitCode !== 0) addMsg("tool", `[exit ${m.exitCode}]${m.stderr ? "\n" + m.stderr : ""}`, "tool");
	} else if (m.type === "agent_event") {
		const evt = m.evt || {};
		if (evt.type === "tool_execution_start" && evt.toolName) {
			addMsg("tool", `▸ ${evt.toolName} ${JSON.stringify(evt.args || {}).slice(0, 100)}`);
			busy(`${currentNode} 调用 ${evt.toolName}…`);
		}
	} else if (m.type === "agent_done") {
		clearBusy();
		if (m.text) addMsg("assistant", m.text);
	} else if (m.type === "context") {
		clearBusy();
		const content = $("content");
		content.innerHTML = `<div class="role" style="color:var(--dim);font-size:12px;margin-bottom:10px;">上下文 (${m.messages.length} 条)</div>`;
		(m.messages || []).forEach((msg) => {
			const role = msg.role;
			if (role === "user" || role === "assistant") {
				const text = (msg.content || []).filter((c) => c.type === "text").map((c) => c.text).join(" ").trim();
				if (text) addMsg(role, text.slice(0, 500));
			} else if (role === "toolResult") {
				const text = (msg.content || []).filter((c) => c.type === "text").map((c) => c.text).join(" ").trim();
				if (text) addMsg("tool", text.slice(0, 200), "tool");
			}
		});
	} else if (m.type === "error") {
		clearBusy();
		addMsg("assistant", `⚠ ${m.message}`, "assistant");
		const b = $("content")?.querySelector(".msg:last-child .body");
		if (b) b.classList.add("err");
	}
};
