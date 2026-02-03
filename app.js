/************************************
 * PUBLIC SHOPPING LIST (PWA)
 * - No login
 * - Public Supabase table: items_public
 * - Realtime sync
 ************************************/

/* ======= HIER EINTRAGEN ======= */
const SUPABASE_URL = "https://tzphjtghncbcziixyzlh.supabase.co";   // <- deine korrekte URL
const SUPABASE_ANON_KEY = "sb_publishable_m7AtxKRROGyIqeihcbRYXw_RxlVoYbH";             // <- sb_publishable_...
/* ============================== */

// "Room" = eure gemeinsame Liste.
// Du kannst das auch in den Link packen, aber erstmal fix.
const ROOM = "family-2026";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ======= UI ======= */
const topSub = document.getElementById("topSub");
const btnShare = document.getElementById("btnShare");
const itemInput = document.getElementById("itemInput");
const btnAdd = document.getElementById("btnAdd");
const itemsBox = document.getElementById("itemsBox");
const toastEl = document.getElementById("toast");

topSub.textContent = `Room: ${ROOM}`;

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  setTimeout(() => toastEl.classList.add("hidden"), 2200);
}

/* ======= SHARE LINK ======= */
btnShare.addEventListener("click", async () => {
  const url = window.location.href;
  const text = `Einkaufsliste Link:\n${url}\n\nRoom: ${ROOM}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: "Einkaufsliste", text });
    } else {
      await navigator.clipboard.writeText(text);
      toast("Link kopiert ✅");
    }
  } catch {
    toast("Teilen abgebrochen");
  }
});

/* ======= CRUD ======= */
async function loadItems() {
  const { data, error } = await supabaseClient
    .from("items_public")
    .select("id, text, created_at")
    .eq("room", ROOM)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("loadItems error:", error);
    toast(error.message || "Fehler beim Laden");
    return;
  }

  renderItems(data || []);
}

async function addItem(text) {
  const t = (text || "").trim();
  if (!t) return;

  const { error } = await supabaseClient
    .from("items_public")
    .insert([{ room: ROOM, text: t }]);

  if (error) {
    console.error("addItem error:", error);
    toast(error.message || "Fehler beim Speichern");
    return;
  }

  itemInput.value = "";
}

async function deleteItem(id) {
  const { error } = await supabaseClient
    .from("items_public")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("deleteItem error:", error);
    toast(error.message || "Fehler beim Löschen");
  }
}

/* ======= RENDER ======= */
function renderItems(items) {
  itemsBox.innerHTML = "";

  if (!items.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Noch keine Items. Füg oben was hinzu.";
    itemsBox.appendChild(p);
    return;
  }

  for (const it of items) {
    const row = document.createElement("div");
    row.className = "itemRow";

    const circle = document.createElement("button");
    circle.className = "circleBtn";
    circle.title = "Klick = löschen";
    circle.addEventListener("click", async () => {
      await deleteItem(it.id);
    });

    const text = document.createElement("div");
    text.className = "itemText";
    text.textContent = it.text;

    row.append(circle, text);
    itemsBox.appendChild(row);
  }
}

/* ======= EVENTS ======= */
btnAdd.addEventListener("click", async () => addItem(itemInput.value));
itemInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") btnAdd.click();
});

/* ======= REALTIME ======= */
let realtimeChannel = null;

function startRealtime() {
  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  realtimeChannel = supabaseClient
    .channel("public_room:" + ROOM)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "items_public", filter: `room=eq.${ROOM}` },
      () => loadItems()
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") toast("Realtime Sync aktiv ✅");
    });
}

/* ======= START ======= */
(async function init() {
  await loadItems();
  startRealtime();
})();
