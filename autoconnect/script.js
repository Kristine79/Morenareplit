const DOWNLOADS = {
  happ: {
    Windows: "https://github.com/hiddify/hiddify-app/releases/latest",
    macOS: "https://github.com/hiddify/hiddify-app/releases/latest",
    Android: "https://play.google.com/store/apps/details?id=app.hiddify.com",
    iOS: "https://apps.apple.com/app/hiddify/id6596777532",
  },
  incy: {
    Windows: "https://github.com/hiddify/hiddify-app/releases/latest",
    macOS: "https://github.com/hiddify/hiddify-app/releases/latest",
    Android: "https://play.google.com/store/apps/details?id=app.hiddify.com",
    iOS: "https://apps.apple.com/app/hiddify/id6596777532",
  },
};

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const subscriptionKey = params.get('key');
    let currentTab = 'happ';
    let currentOS = 'Windows';

    const step2Generic = document.getElementById('step2-generic');
    const step2Personal = document.getElementById('step2-personal');
    const keyDisplay = document.getElementById('subscription-key-display');
    const copyBtn = document.getElementById('copy-key-btn');
    const autoLink = document.getElementById('auto-connect-link');

    if (subscriptionKey) {
        const decodedKey = decodeURIComponent(subscriptionKey);
        step2Generic.classList.add('hidden');
        step2Personal.classList.remove('hidden');
        keyDisplay.textContent = decodedKey;

        const hiddifyDeepLink = `hiddify://import/sing-box?url=${encodeURIComponent(decodedKey)}`;
        autoLink.href = hiddifyDeepLink;

        autoLink.addEventListener('click', (e) => {
            e.preventDefault();
            navigator.clipboard.writeText(decodedKey).catch(() => {});
            window.location.href = hiddifyDeepLink;
            setTimeout(() => {
                const dlUrl = DOWNLOADS[currentTab][currentOS];
                window.location.href = dlUrl;
            }, 1500);
        });

        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(decodedKey).then(() => {
                const originalText = copyBtn.innerHTML;
                copyBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Скопировано';
                copyBtn.classList.add('text-green-400', 'border-green-500/40');
                copyBtn.classList.remove('text-purple-400', 'border-purple-500/40');
                setTimeout(() => {
                    copyBtn.innerHTML = originalText;
                    copyBtn.classList.remove('text-green-400', 'border-green-500/40');
                    copyBtn.classList.add('text-purple-400', 'border-purple-500/40');
                }, 2000);
            }).catch(() => {
                alert('Не удалось скопировать. Выделите ключ вручную.');
            });
        });
    }

    const osDropdownBtn = document.getElementById('os-dropdown-btn');
    const osDropdownMenu = document.getElementById('os-dropdown-menu');
    const osDropdownText = document.getElementById('os-dropdown-text');
    const osDropdownIcon = document.getElementById('os-dropdown-icon');
    const osDropdownChevron = document.getElementById('os-dropdown-chevron');
    const downloadBtn = document.getElementById('download-btn');
    const downloadBtnText = document.getElementById('download-btn-text');
    const osButtons = document.querySelectorAll('.os-option');
    const genericAddBtn = document.getElementById('add-subscription-btn');

    let isDropdownOpen = false;

    const icons = {
        monitor: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-cyan-400 drop-shadow-[0_0_5px_#00f0ff]"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>`,
        smartphone: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-cyan-400 drop-shadow-[0_0_5px_#00f0ff]"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></svg>`
    };

    function updateDownloadLink() {
        const url = DOWNLOADS[currentTab][currentOS];
        downloadBtn.href = url;
        downloadBtnText.textContent = `Скачать ${currentOS}`;
    }

    function toggleDropdown() {
        isDropdownOpen = !isDropdownOpen;
        if (isDropdownOpen) {
            osDropdownMenu.classList.remove('hidden');
            osDropdownChevron.classList.add('rotate-180');
        } else {
            osDropdownMenu.classList.add('hidden');
            osDropdownChevron.classList.remove('rotate-180');
        }
    }

    osDropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDropdown();
    });

    document.addEventListener('click', (e) => {
        if (isDropdownOpen && !osDropdownBtn.contains(e.target) && !osDropdownMenu.contains(e.target)) {
            toggleDropdown();
        }
    });

    osButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const osName = btn.dataset.os;
            const iconType = btn.dataset.icon;

            currentOS = osName;
            osDropdownText.textContent = osName;
            osDropdownIcon.innerHTML = icons[iconType];
            updateDownloadLink();

            osButtons.forEach(b => {
                b.classList.remove('bg-cyan-500/20', 'text-cyan-400', 'border-l-2', 'border-cyan-400');
                b.classList.add('text-slate-400', 'border-transparent');
                const svg = b.querySelector('svg');
                if (svg) svg.setAttribute('stroke-width', '1.5');
            });

            btn.classList.add('bg-cyan-500/20', 'text-cyan-400', 'border-l-2', 'border-cyan-400');
            btn.classList.remove('text-slate-400', 'border-transparent');
            const activeSvg = btn.querySelector('svg');
            if (activeSvg) activeSvg.setAttribute('stroke-width', '2');

            toggleDropdown();
        });
    });

    const tabHapp = document.getElementById('tab-happ');
    const tabIncy = document.getElementById('tab-incy');

    function setActiveTab(tab) {
        currentTab = tab;
        if (tab === 'happ') {
            tabHapp.className = "text-lg font-bold tracking-widest uppercase transition-all duration-300 text-cyan-400 drop-shadow-[0_0_10px_#00f0ff] border-b-2 border-cyan-400 pb-2";
            tabIncy.className = "text-lg font-bold tracking-widest uppercase transition-all duration-300 text-slate-500 hover:text-slate-300 pb-2 border-b-2 border-transparent";
        } else {
            tabIncy.className = "text-lg font-bold tracking-widest uppercase transition-all duration-300 text-purple-400 drop-shadow-[0_0_10px_#a855f7] border-b-2 border-purple-400 pb-2";
            tabHapp.className = "text-lg font-bold tracking-widest uppercase transition-all duration-300 text-slate-500 hover:text-slate-300 pb-2 border-b-2 border-transparent";
        }
        updateDownloadLink();
    }

    tabHapp.addEventListener('click', () => setActiveTab('happ'));
    tabIncy.addEventListener('click', () => setActiveTab('incy'));

    if (genericAddBtn) {
        genericAddBtn.addEventListener('click', () => {
            window.open(DOWNLOADS[currentTab][currentOS], '_blank');
        });
    }

    updateDownloadLink();
});
