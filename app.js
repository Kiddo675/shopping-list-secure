alert("app.js läuft");

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// ====== CONFIG ======
const SUPABASE_URL = "https://tzphjtghncbcziixyzlh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_m7AtxKRROGyIqeihcbRYXw_RxlVoYbH";

// Room (wie bei dir "family-2026")
const ROOM = "family-2026";
// ====================

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $cats = document.querySelector("#categories");
const roomLabel = document.querySelector("#roomLabel");
roomLabel.textContent = `Room: ${ROOM}`;

document.querySelector("#shareBtn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    alert("Link kopiert ✅");
  } catch {
    alert("Konnte Link nicht kopieren. Manuell kopieren bitte.");
  }
});

document.querySelector("#addCategoryBtn").addEventListener("click", async () => {
  const title = prompt("Kategorie-Name?", "Neue Kategorie");
  if (!title) return;
  const nextSort = (state.categories.at(-1)?.sort ?? -1) + 1;

  const { error } = await supabase.from("categories").insert({
  room: ROOM,
  title: title.trim(),
  sort: nextSort,
  collapsed: false
});

if (error) {
  alert("Kategorie-Insert Fehler: " + error.message);
  console.error(error);
}

});

const state = {
  categories: [],
  itemsByCat: new Map(), // catId -> items[]
};

// ---------- realtime subscriptions ----------
let catChannel, itemChannel;

async function subscribeRealtime() {
  if (catChannel) await supabase.removeChannel(catChannel);
  if (itemChannel) await supabase.removeChannel(itemChannel);

  catChannel = supabase
    .channel(`cats:${ROOM}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "categories", filter: `room=eq.${ROOM}` },
      () => loadAll()
    )
    .subscribe();

  itemChannel = supabase
    .channel(`items:${ROOM}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "items", filter: `room=eq.${ROOM}` },
      () => loadAll()
    )
    .subscribe();
}

async function loadAll() {
  const { data: categories, error: cErr } = await supabase
    .from("categories")
    .select("*")
    .eq("room", ROOM)
    .order("sort", { ascending: true });

  if (cErr) {
    console.error(cErr);
    $cats.innerHTML = `<div style="padding:14px;color:#ffb3b3">Fehler categories: ${cErr.message}</div>`;
    return;
  }
  await loadAll(); // <<< wichtig

  // Wenn noch keine Kategorie existiert: Default anlegen
  if (!categories || categories.length === 0) {
    await supabase.from("categories").insert({ room: ROOM, title: "Edeka", sort: 0 });
    await supabase.from("categories").insert({ room: ROOM, title: "Bakkal", sort: 1 });
    await supabase.from("categories").insert({ room: ROOM, title: "Rewe", sort: 2 });
    await supabase.from("categories").insert({ room: ROOM, title: "Drogerie", sort: 3 });
    return loadAll();
  }

  const { data: items, error: iErr } = await supabase
    .from("items")
    .select("*")
    .eq("room", ROOM)
    .order("sort", { ascending: true });

  if (iErr) {
    console.error(iErr);
    $cats.innerHTML = `<div style="padding:14px;color:#ffb3b3">Fehler items: ${iErr.message}</div>`;
    return;
  }
  await loadAll(); // <<< wichtig

  state.categories = categories;
  state.itemsByCat.clear();

  for (const cat of categories) state.itemsByCat.set(cat.id, []);
  for (const it of items || []) {
    if (!state.itemsByCat.has(it.category_id)) continue;
    state.itemsByCat.get(it.category_id).push(it);
  }

  render();
}

function render() {
  $cats.innerHTML = "";
  const catTpl = document.querySelector("#categoryTpl");
  const itemTpl = document.querySelector("#itemTpl");

  state.categories.forEach((cat, index) => {
    const node = catTpl.content.firstElementChild.cloneNode(true);
    node.dataset.id = cat.id;

    // drag & drop categories
    node.addEventListener("dragstart", () => {
      node.classList.add("dragging");
      node.dataset.dragIndex = String(index);
    });
    node.addEventListener("dragend", () => {
      node.classList.remove("dragging");
      node.classList.remove("dropTarget");
    });
    node.addEventListener("dragover", (e) => {
      e.preventDefault();
      node.classList.add("dropTarget");
    });
    node.addEventListener("dragleave", () => node.classList.remove("dropTarget"));
    node.addEventListener("drop", async (e) => {
      e.preventDefault();
      node.classList.remove("dropTarget");
      const dragging = document.querySelector(".section.dragging");
      if (!dragging) return;

      const fromId = dragging.dataset.id;
      const toId = node.dataset.id;
      if (fromId === toId) return;

      const fromIdx = state.categories.findIndex(c => c.id === fromId);
      const toIdx = state.categories.findIndex(c => c.id === toId);
      await reorderCategories(fromIdx, toIdx);
    });

    if (cat.collapsed) node.classList.add("collapsed");

    const chev = node.querySelector(".chev");
    const title = node.querySelector(".section__title");
    const list = node.querySelector(".list");
    const itemInput = node.querySelector(".itemInput");

    title.textContent = cat.title;

    chev.addEventListener("click", async () => {
      await supabase.from("categories").update({ collapsed: !cat.collapsed }).eq("id", cat.id);
    });

    // rename category (contenteditable)
    let renameTimer;
    title.addEventListener("input", () => {
      clearTimeout(renameTimer);
      renameTimer = setTimeout(async () => {
        const newTitle = title.textContent.trim() || "Kategorie";
        await supabase.from("categories").update({ title: newTitle }).eq("id", cat.id);
      }, 350);
    });

    // move up/down buttons
    node.querySelector(".moveUp").addEventListener("click", async () => {
      await reorderCategories(index, Math.max(0, index - 1));
    });
    node.querySelector(".moveDown").addEventListener("click", async () => {
      await reorderCategories(index, Math.min(state.categories.length - 1, index + 1));
    });

    // delete category
    node.querySelector(".delCat").addEventListener("click", async () => {
      const ok = confirm(`Kategorie "${cat.title}" wirklich löschen? (Items werden mit gelöscht)`);
      if (!ok) return;
      await supabase.from("categories").delete().eq("id", cat.id);
    });

    // add item inside this category
    node.querySelector(".addItemBtn").addEventListener("click", async () => {
      await addItem(cat.id, itemInput.value);
      itemInput.value = "";
      itemInput.focus();
    });
    itemInput.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        await addItem(cat.id, itemInput.value);
        itemInput.value = "";
      }
    });

    // render items
    const items = state.itemsByCat.get(cat.id) || [];
    list.innerHTML = "";
    items.forEach((it, itIdx) => {
      const row = itemTpl.content.firstElementChild.cloneNode(true);
      row.dataset.id = it.id;
      row.classList.toggle("done", !!it.done);
      row.querySelector(".row__text").textContent = it.title;

      row.querySelector(".circle").addEventListener("click", async () => {
        await supabase.from("items").update({ done: !it.done }).eq("id", it.id);
      });
      row.querySelector(".trash").addEventListener("click", async () => {
        await supabase.from("items").delete().eq("id", it.id);
      });

      // (optional) quick reorder in category via alt+up/down? (später)
      list.appendChild(row);
    });

    $cats.appendChild(node);
  });
}

async function addItem(categoryId, rawTitle) {
  const title = (rawTitle || "").trim();
  if (!title) return;

  const items = state.itemsByCat.get(categoryId) || [];
  const nextSort = (items.at(-1)?.sort ?? -1) + 1;

  const { error } = await supabase.from("items").insert({
  room: ROOM,
  category_id: categoryId,
  title,
  done: false,
  sort: nextSort
});

if (error) {
  alert("Item-Insert Fehler: " + error.message);
  console.error(error);
}

}

async function reorderCategories(fromIdx, toIdx) {
  if (fromIdx === toIdx) return;

  const arr = [...state.categories];
  const [moved] = arr.splice(fromIdx, 1);
  arr.splice(toIdx, 0, moved);

  // neue sort-Werte schreiben (0..n)
  const updates = arr.map((c, i) => ({ id: c.id, sort: i }));
  // Supabase update per row:
  for (const u of updates) {
    await supabase.from("categories").update({ sort: u.sort }).eq("id", u.id);
  }
}

// init
(async function init() {
  await subscribeRealtime();
  await loadAll();
})();
