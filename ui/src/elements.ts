export class Panel {
  root: HTMLElement;
  tabbar: HTMLElement;
  editor: HTMLElement;
  meditor: monaco.editor.IStandaloneCodeEditor;
  content: HTMLElement;

  tabs = new Map<string, HTMLElement>();
  models = new Map<string, monaco.editor.ITextModel | null>();
  onTabChange = new Map<string, () => boolean | void | Promise<boolean | void>>();

  current_tab: string | null = null;
  current_model: monaco.editor.ITextModel | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.role = "tabpanel";

    this.tabbar = document.createElement("div");
    this.tabbar.className = "tabbar";
    this.tabbar.role = "tablist";

    this.editor = document.createElement("div")
    this.editor.className = "editor";

    this.meditor = monaco.editor.create(this.editor, {
      automaticLayout: true
    });
    this.meditor.addAction({
      id: 'TOGGLE_TAB_FOCUS_MODE',
      label: 'Toggle Tab Key Moves Focus',
      run: (ed) => {
        ed.trigger('shortcut', 'editor.action.toggleTabFocusMode', '');
      }
    });

    this.content = document.createElement("div")
    this.content.className = "content";
    this.content.tabIndex = 0;

    root.appendChild(this.tabbar);
    root.appendChild(this.editor);
    root.appendChild(this.content);
  }

  addTab(name: string, model: monaco.editor.ITextModel | null = null, onTabChange?: () => boolean | void) {
    const tab = document.createElement("button");
    tab.className = "tab";
    tab.role = "tab";
    tab.textContent = name;

    tab.onclick = () => this.setTab(name);

    this.tabs.set(name, tab);
    this.models.set(name, model);
    this.tabbar.appendChild(tab);
    if (onTabChange)
      this.onTabChange.set(name, onTabChange);

    if (this.current_tab === null)
      this.setTab(name);
  }

  #id = 0;
  setTab(name: string) {
    const tab = this.tabs.get(name);
    if (!tab)
      throw new Error(`Unknown tab: ${name}`);

    if (this.current_tab === name) {
      this.meditor.layout();
      this.meditor.focus();
      return;
    }
    this.current_tab = name;

    for (const el of this.tabs.values()) {
      el.classList.toggle("active", el === tab);
      el.ariaSelected = el === tab ? 'true' : 'false';
    }

    const model = this.models.get(name)!;
    this.meditor.setModel(model);
    this.current_model = model;
    tab.classList.toggle('hide-editor', model == null);
    this.content.textContent = '';

    if (model != null) {
      this.meditor.layout();
      this.meditor.focus();
    } else {
      this.content.focus();
    }

    const onTabChange = this.onTabChange.get(name);
    if (onTabChange) {
      const showContent = onTabChange();
      if (showContent instanceof Promise) {
        const i = ++this.#id;
        showContent.then(v => {
          if (this.#id === i)
            tab.classList.toggle('hide-content', v === false);
        });
      } else {
        tab.classList.toggle('hide-content', showContent === false);
      }
    } else {
      tab.classList.add('hide-content');
    }
  }
}
