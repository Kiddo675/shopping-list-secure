/************************************
 * SECURE SHOPPING LIST (PWA)
 * - Supabase Auth (Magic Link)
 * - RLS secured data
 * - Invite Code join
 * - Realtime sync
 * - Apple-like UI
 * - Persistent autocomplete via item_dictionary
 ************************************/

/* ======= HIER EINTRAGEN ======= */
const SUPABASE_URL = "https://tzphjtghncbcziixyzlh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_m7AtxKRROGyIqeihcbRYXw_RxlVoYbH";
/* ============================== */

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ======= UI ELEMENTS ======= */
const screenLogin = document.getElementById("screenLogin");
const screenLists = document.getElementById("screenLists");
const screenList = document.getElementById("screenList");

const topTitle = document.getElementById("topTitle");
const topSub = document.getElementById("topSub");
const btnShare = document.getElementById("btnShare");
const btnLogout = document.getElementById("btnLogout");
const btnBack = document.getElementById("btnBack");

const emailInput = document.getElementById("emailInput");
const btnSendLink = document.getElementById("btnSendLink");

const listsBox = document.getElementById("listsBox");
const newListName = document.getElementById("newListName");
const btnCreateList = document.getElementById("btnCreateList");
const joinCode = document.getElementById("joinCode");
const btnJoin = document.getElementById("btnJoin");

const newCategoryName = document.getElementById("newCategoryName");
const btnAddCategory = document.getElementById("btnAddCategory");
const categoriesEl = document.getElementById("categories");

const fabAdd = document.getElementById("fabAdd");
const toastEl = document.getElementById("toast");

/* ======= STATE ======= */
let sessionUser = null;

let activeListId = localStorage.getItem("activeListId") || null;
let activeInviteCode = localStorage.getItem("activeInviteCode") || null;
let activeListName = localStorage.getItem("activeListName") || "Einkaufsliste";

let lists = [];
let categories = [];
let items = [];
let suggestionPool = []; // from item_dictionary (dauerhaft)

let realtimeChannel = null;

const SUGGESTION_LIMIT = 6; // <- HIER Anzahl Vorschläge ändern
const MIN_PREFIX_LEN = 1;   // <- ab wie vielen Buchstaben Vorschläge erscheinen

/* ======= HELPERS ======= */
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  setTimeout(() => toastEl.classList.add("hidden"), 2200);
}

function show(view) {
  screenLogin.style.display = "none";
  screenLists.style.display = "none";
  screenList.style.display = "none";

  if (view === "login") screenLogin.style.display = "block";
  if (view === "lists") screenLists.style.display = "block";
  if (view === "list") screenList.style.display = "block";
}

function setTopBar(mode) {
  // mode: login | lists | list
  if (mode === "login") {
    topTitle.textContent = "Einkaufsliste";
    topSub.textContent = "Bitte anmelden";
    btnShare.style.display = "none";
    fabAdd.style.display = "none";
    btnBack.style.display = "none";
    return;
  }

  if (mode === "lists") {
    topTitle.textContent = "Einkaufsliste";
    topSub.textContent = "Listen verwalten";
    btnShare.style.display = "none";
    fabAdd.style.display = "none";
    btnBack.style.display = "none";
    return;
  }

  if (mode === "list") {
    topTitle.textContent = activeListName || "Einkaufsliste";
    topSub.textContent = activeInviteCode ? `Invite-Code: ${activeInviteCode}` : "—";
    btnShare.style.display = "inline-block";
    fabAdd.style.display = "block";
    btnBack.style.display = "inline-block";
  }
}

function sortByOrder(a, b) {
  return (a.order ?? 1000) - (b.order ?? 1000);
}

function getNextOrder(arr) {
  if (!arr.length) return 10;
  const max = Math.max(...arr.map(x => x.order ?? 0));
  return max + 10;
}

function collapsedKey(catId) {
  return `collapsed:${activeListId}:${catId}`;
}
function isCollapsed(catId) {
  return localStorage.getItem(collapsedKey(catId)) === "1";
}
function toggleCollapsed(catId) {
  const key = collapsedKey(catId);
  localStorage.setItem(key, isCollapsed(catId) ? "0" : "1");
}

/* ======= AUTH FLOW ======= */
async function refreshSession() {
  // Magic-Link callback: code -> session tauschen
try {
  const url = new URL(window.location.href);
  if (url.searchParams.get("code")) {
    await supabaseClient.auth.exchangeCodeForSession(window.location.href);
    url.searchParams.delete("code");
    window.history.replaceState({}, document.title, url.toString());
  }
} catch (e) {
  console.warn("exchangeCodeForSession failed", e);
}

  const { data } = await supabaseClient.auth.getSession();
  sessionUser = data?.session?.user || null;

  if (!sessionUser) {
    stopRealtime();
    activeListId = null;
    activeInviteCode = null;
    localStorage.removeItem("activeListId");
    localStorage.removeItem("activeInviteCode");
    show("login");
    setTopBar("login");
    return;
  }

  // eingeloggt
  await loadLists();
  show("lists");
  setTopBar("lists");

  // wenn schon eine aktive Liste gespeichert ist -> direkt öffnen
  if (activeListId) {
    const stillExists = lists.find(l => l.id === activeListId);
    if (stillExists) {
      activeListName = stillExists.name;
      localStorage.setItem("activeListName", activeListName);
      await openList(activeListId, stillExists.invite_code, stillExists.name);
    } else {
      activeListId = null;
      activeInviteCode = null;
      localStorage.removeItem("activeListId");
      localStorage.removeItem("activeInviteCode");
    }
  }
}

btnSendLink.addEventListener("click", async () => {
  const email = (emailInput.value || "").trim();
  if (!email) return toast("Bitte Email eingeben");

  // redirectTo muss in Supabase Auth settings erlaubt sein
  const redirectTo = "https://kiddo675.github.io/shopping-list-secure/";

  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo }
  });

  if (error) {
  console.error("Magic link error:", error);
  toast(error.message || "Fehler beim Senden des Links");
  alert(error.message || "Fehler beim Senden des Links");
  return;
}


  toast("Magic-Link gesendet ✅ (Email öffnen)");
});

btnLogout.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  toast("Ausgeloggt");
  await refreshSession();
});

supabaseClient.auth.onAuthStateChange(async () => {
  await refreshSession();
});

/* ======= LISTS ======= */
async function loadLists() {
  const { data, error } = await supabaseClient
    .from("lists")
    .select("id,name,invite_code,created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    toast("Listen konnten nicht geladen werden");
    return;
  }

  lists = data || [];
  renderLists();
}

function renderLists() {
  listsBox.innerHTML = "";

  if (!lists.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Noch keine Liste. Erstelle unten eine oder tritt per Code bei.";
    listsBox.appendChild(p);
    return;
  }

  for (const l of lists) {
    const row = document.createElement("div");
    row.className = "row";
    row.style.marginTop = "10px";

    const btn = document.createElement("button");
    btn.className = "btn primary";
    btn.style.flex = "1";
    btn.textContent = `${l.name}  (Code: ${l.invite_code})`;

    btn.addEventListener("click", async () => {
      await openList(l.id, l.invite_code, l.name);
    });

    row.appendChild(btn);
    listsBox.appendChild(row);
  }
}

btnCreateList.addEventListener("click", async () => {
  const name = (newListName.value || "").trim() || "Einkaufsliste";

  const { data, error } = await supabaseClient.rpc("create_list", { p_name: name });
  if (error) {
    console.error(error);
    return toast("Konnte Liste nicht erstellen");
  }

  // RPC returns table rows, take first
  const first = Array.isArray(data) ? data[0] : data;
  const listId = first.list_id;
  const code = first.invite_code;

  toast("Liste erstellt ✅");
  newListName.value = "";

  await loadLists();
  await openList(listId, code, name);
});

btnJoin.addEventListener("click", async () => {
  const code = (joinCode.value || "").trim().toUpperCase();
  if (!code) return toast("Invite-Code eingeben");

  const { data, error } = await supabaseClient.rpc("join_list_by_code", { p_invite_code: code });
  if (error) {
    console.error(error);
    return toast("Code ungültig oder Fehler");
  }

  const listId = data; // returns uuid
  toast("Beigetreten ✅");
  joinCode.value = "";

  await loadLists();
  const found = lists.find(l => l.id === listId) || lists.find(l => l.invite_code === code);
  await openList(listId, code, found?.name || "Einkaufsliste");
});

/* ======= OPEN LIST ======= */
async function openList(listId, inviteCode, name) {
  activeListId = listId;
  activeInviteCode = inviteCode;
  activeListName = name || "Einkaufsliste";

  localStorage.setItem("activeListId", activeListId);
  localStorage.setItem("activeInviteCode", activeInviteCode);
  localStorage.setItem("activeListName", activeListName);

  show("list");
  setTopBar("list");

  await loadAll();
  startRealtime();
}

btnBack.addEventListener("click", async () => {
  stopRealtime();
  show("lists");
  setTopBar("lists");
  await loadLists();
});

/* ======= SHARE CODE ======= */
btnShare.addEventListener("click", async () => {
  if (!activeInviteCode) return;

  const text = `Unser Einkaufsliste Invite-Code: ${activeInviteCode}\n\n1) Öffne die App\n2) Login per Email\n3) "Liste beitreten" → Code eingeben`;

  try {
    if (navigator.share) {
      await navigator.share({ title: "Einkaufsliste", text });
    } else {
      await navigator.clipboard.writeText(text);
      toast("Code kopiert ✅");
    }
  } catch {
    toast("Teilen abgebrochen");
  }
});

/* ======= LOAD DATA ======= */
async function loadAll() {
  if (!activeListId) return;

  // categories
  const { data: catData, error: catErr } = await supabaseClient
    .from("categories")
    .select("*")
    .eq("list_id", activeListId)
    .order("order", { ascending: true });

  if (catErr) {
    console.error(catErr);
    toast("Fehler: Kategorien laden");
    return;
  }
  categories = catData || [];

  // items
  const { data: itemData, error: itemErr } = await supabaseClient
    .from("items")
    .select("*")
    .eq("list_id", activeListId)
    .order("order", { ascending: true });

  if (itemErr) {
    console.error(itemErr);
    toast("Fehler: Items laden");
    return;
  }
  items = itemData || [];

  // dictionary (autocomplete dauerhaft)
  await loadDictionary();

  render();
}

/* ======= DICTIONARY ======= */
async function loadDictionary() {
  if (!activeListId) return;

  const { data, error } = await supabaseClient
    .from("item_dictionary")
    .select("text, usage_count, last_used_at")
    .eq("list_id", activeListId)
    .order("usage_count", { ascending: false })
    .order("last_used_at", { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  suggestionPool = (data || []).map(x => x.text);
}

async function upsertDictionary(text) {
  const cleaned = (text || "").trim();
  if (!cleaned) return;

  // Erst Insert versuchen
  const ins = await supabaseClient
    .from("item_dictionary")
    .insert([{ list_id: activeListId, text: cleaned, usage_count: 1, last_used_at: new Date().toISOString() }]);

  if (!ins.error) return;

  // Wenn unique conflict -> usage_count erhöhen
  const { data: existing, error: selErr } = await supabaseClient
    .from("item_dictionary")
    .select("usage_count")
    .eq("list_id", activeListId)
    .eq("text", cleaned)
    .maybeSingle();

  if (selErr) return;

  const newCount = (existing?.usage_count || 0) + 1;
  await supabaseClient
    .from("item_dictionary")
    .update({ usage_count: newCount, last_used_at: new Date().toISOString() })
    .eq("list_id", activeListId)
    .eq("text", cleaned);
}

/* ======= REALTIME ======= */
function startRealtime() {
  stopRealtime();
  if (!activeListId) return;

  realtimeChannel = supabaseClient
    .channel("list:" + activeListId)
    .on("postgres_changes", { event: "*", schema: "public", table: "categories", filter: `list_id=eq.${activeListId}` }, () => loadAll())
    .on("postgres_changes", { event: "*", schema: "public", table: "items", filter: `list_id=eq.${activeListId}` }, () => loadAll())
    .on("postgres_changes", { event: "*", schema: "public", table: "item_dictionary", filter: `list_id=eq.${activeListId}` }, () => loadAll())
    .subscribe((status) => {
      if (status === "SUBSCRIBED") toast("Realtime Sync aktiv ✅");
    });
}

function stopRealtime() {
  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

/* ======= AUTOCOMPLETE ======= */
function getSuggestions(prefix) {
  const p = (prefix || "").trim().toLowerCase();
  if (p.length < MIN_PREFIX_LEN) return [];

  const matches = suggestionPool
    .filter(s => s.toLowerCase().startsWith(p));

  // Sort: kürzer zuerst, dann alphabetisch
  matches.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return matches.slice(0, SUGGESTION_LIMIT);
}

/* ======= RENDER ======= */
function render() {
  categoriesEl.innerHTML = "";

  const sortedCats = [...categories].sort(sortByOrder);

  if (!sortedCats.length) {
    const empty = document.createElement("div");
    empty.className = "card";
    empty.innerHTML = `<p class="muted">Noch keine Kategorien. Leg eine an (z.B. Aldi).</p>`;
    categoriesEl.appendChild(empty);
    return;
  }

  // map category -> items
  const itemMap = new Map();
  for (const it of items) {
    if (!itemMap.has(it.category_id)) itemMap.set(it.category_id, []);
    itemMap.get(it.category_id).push(it);
  }
  for (const arr of itemMap.values()) arr.sort(sortByOrder);

  for (const cat of sortedCats) {
    const block = document.createElement("section");
    block.className = "categoryBlock";

    const header = document.createElement("div");
    header.className = "categoryHeader";

    const title = document.createElement("div");
    title.className = "catTitle";
    title.textContent = cat.name;

    const chev = document.createElement("button");
    chev.className = "chevBtn";
    chev.textContent = isCollapsed(cat.id) ? "▾" : "▴"; // Apple-like fold indicator
    chev.title = "Einklappen/Ausklappen";

    chev.addEventListener("click", () => {
      toggleCollapsed(cat.id);
      render();
    });

    header.append(title, chev);

    // add item row (Apple-style)
    const addRow = document.createElement("div");
    addRow.className = "smallRow";

    const suggestionWrap = document.createElement("div");
    suggestionWrap.style.position = "relative";
    suggestionWrap.style.flex = "1";

    const itemInput = document.createElement("input");
    itemInput.className = "input";
    itemInput.placeholder = `+ Item zu ${cat.name}`;

    const dropdown = document.createElement("div");
    dropdown.className = "dropdown";

    suggestionWrap.appendChild(itemInput);
    suggestionWrap.appendChild(dropdown);

    function renderDropdown(list) {
      dropdown.innerHTML = "";
      if (!list.length) {
        dropdown.style.display = "none";
        return;
      }
      for (const t of list) {
        const r = document.createElement("div");
        r.className = "dropItem";
        r.textContent = t;
        r.addEventListener("click", () => {
          itemInput.value = t;
          dropdown.style.display = "none";
          itemInput.focus();
        });
        dropdown.appendChild(r);
      }
      dropdown.style.display = "block";
    }

    itemInput.addEventListener("input", () => {
      const sugg = getSuggestions(itemInput.value);
      renderDropdown(sugg);
    });

    document.addEventListener("click", (e) => {
      if (!suggestionWrap.contains(e.target)) dropdown.style.display = "none";
    });

    const btnAdd = document.createElement("button");
    btnAdd.className = "btn";
    btnAdd.textContent = "+";

    btnAdd.addEventListener("click", async () => {
      const t = (itemInput.value || "").trim();
      if (!t) return;

      const catItems = (itemMap.get(cat.id) || []).sort(sortByOrder);
      await addItem(cat.id, t, catItems);
      itemInput.value = "";
    });

    itemInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") btnAdd.click();
    });

    addRow.append(suggestionWrap, btnAdd);

    block.append(header);
    block.append(addRow);

    // items list
    if (!isCollapsed(cat.id)) {
      const catItems = (itemMap.get(cat.id) || []).sort(sortByOrder);

      for (const it of catItems) {
        const row = document.createElement("div");
        row.className = "itemRow";

        // Apple-like circle instead of checkbox
        const circle = document.createElement("button");
        circle.className = "circleBtn";
        circle.title = "Abhaken = löschen";
        circle.addEventListener("click", async () => {
          await deleteItem(it.id);
        });

        const text = document.createElement("div");
        text.className = "itemText";
        text.textContent = it.text;

        const actions = document.createElement("div");
        actions.className = "itemActions";

        const btnUp = document.createElement("button");
        btnUp.className = "iconBtn";
        btnUp.textContent = "↑";
        btnUp.title = "hoch";
        btnUp.addEventListener("click", async () => {
          await moveItemWithinCategory(it.id, -1, catItems);
        });

        const btnDown = document.createElement("button");
        btnDown.className = "iconBtn";
        btnDown.textContent = "↓";
        btnDown.title = "runter";
        btnDown.addEventListener("click", async () => {
          await moveItemWithinCategory(it.id, +1, catItems);
        });

        const btnEdit = document.createElement("button");
        btnEdit.className = "iconBtn";
        btnEdit.textContent = "✏️";
        btnEdit.title = "bearbeiten";
        btnEdit.addEventListener("click", async () => {
          const newText = prompt("Item ändern:", it.text);
          if (newText === null) return;
          const cleaned = newText.trim();
          if (!cleaned) return;
          await updateItemText(it.id, cleaned);
          await upsertDictionary(cleaned);
        });

        actions.append(btnUp, btnDown, btnEdit);

        row.append(circle, text, actions);
        block.appendChild(row);
      }
    }

    categoriesEl.appendChild(block);
  }
}

/* ======= CRUD ======= */
btnAddCategory.addEventListener("click", async () => {
  const name = (newCategoryName.value || "").trim();
  if (!name) return;

  await addCategory(name);
  newCategoryName.value = "";
});

async function addCategory(name) {
  const next = getNextOrder(categories);
  const { error } = await supabaseClient
    .from("categories")
    .insert([{ list_id: activeListId, name, order: next }]);

  if (error) {
    console.error(error);
    toast("Fehler: Kategorie nicht erstellt");
  }
}

async function addItem(categoryId, text, currentItems) {
  const next = getNextOrder(currentItems || []);
  const { error } = await supabaseClient
    .from("items")
    .insert([{ list_id: activeListId, category_id: categoryId, text, order: next }]);

  if (error) {
    console.error(error);
    toast("Fehler: Item nicht erstellt");
    return;
  }

  // dauerhaftes Autocomplete
  await upsertDictionary(text);
}

async function updateItemText(itemId, text) {
  const { error } = await supabaseClient
    .from("items")
    .update({ text, updated_at: new Date().toISOString() })
    .eq("id", itemId);

  if (error) {
    console.error(error);
    toast("Fehler: Item nicht gespeichert");
  }
}

async function deleteItem(itemId) {
  const { error } = await supabaseClient
    .from("items")
    .delete()
    .eq("id", itemId);

  if (error) {
    console.error(error);
    toast("Fehler: Item nicht gelöscht");
  }
}

async function moveItemWithinCategory(itemId, direction, catItems) {
  const sorted = [...catItems].sort(sortByOrder);
  const idx = sorted.findIndex(i => i.id === itemId);
  const swapIdx = idx + direction;
  if (idx < 0 || swapIdx < 0 || swapIdx >= sorted.length) return;

  const a = sorted[idx];
  const b = sorted[swapIdx];

  const { error } = await supabaseClient
    .from("items")
    .upsert([
      { id: a.id, order: b.order, updated_at: new Date().toISOString() },
      { id: b.id, order: a.order, updated_at: new Date().toISOString() }
    ], { onConflict: "id" });

  if (error) {
    console.error(error);
    toast("Fehler: Reihenfolge");
  }
}

/* ======= Floating + Quick Add ======= */
fabAdd.addEventListener("click", async () => {
  if (!categories.length) return toast("Erst eine Kategorie anlegen");

  // Kategorie wählen
  const names = categories.sort(sortByOrder).map(c => c.name).join(", ");
  const target = prompt(`Zu welcher Kategorie?\nVerfügbar: ${names}`);
  if (!target) return;

  const cat = categories.find(c => c.name.toLowerCase() === target.trim().toLowerCase());
  if (!cat) return toast("Kategorie nicht gefunden (genau tippen)");

  const text = prompt("Was hinzufügen?");
  if (!text) return;

  // Items in der Kategorie ermitteln
  const catItems = items.filter(i => i.category_id === cat.id).sort(sortByOrder);
  await addItem(cat.id, text.trim(), catItems);
});

/* ======= START ======= */
(async function init() {
  setTopBar("login");
  show("login");
  await refreshSession();
})();
