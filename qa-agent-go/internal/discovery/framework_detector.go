package discovery

import (
	"github.com/playwright-community/playwright-go"
)

// Framework represents a detected JavaScript framework
type Framework string

const (
	FrameworkReact   Framework = "react"
	FrameworkAngular Framework = "angular"
	FrameworkVue     Framework = "vue"
	FrameworkNextJS  Framework = "nextjs"
	FrameworkNuxt    Framework = "nuxt"
	FrameworkSvelte  Framework = "svelte"
	FrameworkJQuery  Framework = "jquery"
	FrameworkPlain   Framework = "plain_html"
	FrameworkUnknown Framework = "unknown"
)

// ComponentLibrary represents a detected UI component library
type ComponentLibrary string

const (
	LibMUI       ComponentLibrary = "material_ui"
	LibAntD      ComponentLibrary = "ant_design"
	LibShadcn    ComponentLibrary = "shadcn"
	LibBootstrap ComponentLibrary = "bootstrap"
	LibChakra    ComponentLibrary = "chakra"
	LibTailwind  ComponentLibrary = "tailwind"
	LibUnknown   ComponentLibrary = "unknown"
)

// DetectedStack holds detected framework and component library
type DetectedStack struct {
	Framework      Framework
	ComponentLib   ComponentLibrary
	SelectorHints  map[string]string // e.g. "testid_attr" -> "data-testid"
}

// FrameworkDetector detects JS frameworks and UI libraries from page globals
type FrameworkDetector struct{}

// NewFrameworkDetector creates a new FrameworkDetector
func NewFrameworkDetector() *FrameworkDetector {
	return &FrameworkDetector{}
}

// DetectStack evaluates JavaScript on the page to detect framework and UI library
func (d *FrameworkDetector) DetectStack(page playwright.Page) (*DetectedStack, error) {
	stack := &DetectedStack{
		Framework:    FrameworkUnknown,
		ComponentLib: LibUnknown,
		SelectorHints: map[string]string{
			"testid_attr": "data-testid",
			"prefer":      "css",
		},
	}

	script := `() => {
		const result = {
			react: false, angular: false, vue: false,
			nextjs: false, nuxt: false, svelte: false, jquery: false,
			mui: false, antd: false, bootstrap: false, chakra: false, tailwind: false, shadcn: false
		};

		// React
		if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || document.querySelector('[data-reactroot]') ||
			document.querySelector('[data-react-checksum]')) {
			result.react = true;
		}
		// Next.js (built on React)
		if (window.__NEXT_DATA__) { result.nextjs = true; result.react = true; }

		// Angular
		if (window.getAllAngularRootElements || document.querySelector('[ng-version]') ||
			document.querySelector('app-root') || window.ng) {
			result.angular = true;
		}

		// Vue
		if (window.__VUE__ || window.__vue_devtools_global_hook__ ||
			document.querySelector('[data-v-app]') || document.querySelector('#__nuxt')) {
			result.vue = true;
		}
		if (window.__NUXT__) { result.nuxt = true; result.vue = true; }

		// Svelte
		const allElements = document.querySelectorAll('*');
		for (let el of allElements) {
			const keys = Object.keys(el);
			if (keys.some(k => k.startsWith('__svelte'))) { result.svelte = true; break; }
		}

		// jQuery
		if (window.jQuery || window.$) result.jquery = true;

		// Material UI
		if (document.querySelector('.MuiButton-root') || document.querySelector('.MuiTextField-root')) result.mui = true;

		// Ant Design
		if (document.querySelector('.ant-btn') || document.querySelector('.ant-input')) result.antd = true;

		// Bootstrap
		if (document.querySelector('.btn.btn-primary') || document.querySelector('.form-control')) result.bootstrap = true;

		// Chakra UI
		if (document.querySelector('[data-chakra-component]') || window.__chakra_factory__) result.chakra = true;

		// Tailwind (check for tailwind config or classes)
		if (document.querySelector('[class*="tw-"]') ||
			Array.from(document.styleSheets).some(ss => { try { return Array.from(ss.cssRules).some(r => r.cssText && r.cssText.includes('tailwind')); } catch(e) { return false; } })) {
			result.tailwind = true;
		}

		// Shadcn (uses Radix + Tailwind)
		if (document.querySelector('[data-radix-popper-content-wrapper]') || document.querySelector('[cmdk-root]')) result.shadcn = true;

		return result;
	}`

	res, err := page.Evaluate(script)
	if err != nil {
		// Non-fatal: default to unknown
		return stack, nil
	}

	detected, ok := res.(map[string]interface{})
	if !ok {
		return stack, nil
	}

	getBool := func(key string) bool {
		v, ok := detected[key]
		if !ok {
			return false
		}
		b, _ := v.(bool)
		return b
	}

	// Set framework (priority order)
	switch {
	case getBool("nextjs"):
		stack.Framework = FrameworkNextJS
		stack.SelectorHints["testid_attr"] = "data-testid"
	case getBool("nuxt"):
		stack.Framework = FrameworkNuxt
	case getBool("react"):
		stack.Framework = FrameworkReact
		stack.SelectorHints["testid_attr"] = "data-testid"
	case getBool("angular"):
		stack.Framework = FrameworkAngular
		stack.SelectorHints["prefer"] = "aria"
	case getBool("vue"):
		stack.Framework = FrameworkVue
	case getBool("svelte"):
		stack.Framework = FrameworkSvelte
	case getBool("jquery"):
		stack.Framework = FrameworkJQuery
	default:
		stack.Framework = FrameworkPlain
	}

	// Set component library
	switch {
	case getBool("shadcn"):
		stack.ComponentLib = LibShadcn
	case getBool("mui"):
		stack.ComponentLib = LibMUI
		stack.SelectorHints["button"] = ".MuiButton-root"
		stack.SelectorHints["input"] = ".MuiInputBase-input"
	case getBool("antd"):
		stack.ComponentLib = LibAntD
		stack.SelectorHints["button"] = ".ant-btn"
		stack.SelectorHints["input"] = ".ant-input"
	case getBool("chakra"):
		stack.ComponentLib = LibChakra
	case getBool("tailwind"):
		stack.ComponentLib = LibTailwind
	case getBool("bootstrap"):
		stack.ComponentLib = LibBootstrap
		stack.SelectorHints["button"] = ".btn"
		stack.SelectorHints["input"] = ".form-control"
	}

	return stack, nil
}
