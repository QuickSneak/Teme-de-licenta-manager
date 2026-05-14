document.addEventListener('DOMContentLoaded', function() {
    const body = document.body;

    const themeToggle = document.getElementById("themeToggle");
    const moonOption = document.querySelector(".theme-option.moon");
    const sunOption = document.querySelector(".theme-option.sun");
    const modeIcon = document.getElementById("modeIcon");
    const modeText = document.getElementById("modeText");

    const roleButtons = document.querySelectorAll(".role-btn");
    const loginForm = document.getElementById("loginForm");
    const teamsBtn = document.getElementById("teamsBtn");
    const showPasswordBtn = document.getElementById("showPasswordBtn");
    const passwordInput = document.getElementById("password");
    const rememberMeInput = document.getElementById("rememberMe");

    const toast = document.getElementById("toast");
    const toastText = document.getElementById("toastText");

    let selectedRole = "student";

    function setTheme(theme) {
        const isDark = theme === "dark";

        body.classList.toggle("dark", isDark);

        moonOption.classList.toggle("active", isDark);
        sunOption.classList.toggle("active", !isDark);

        modeIcon.textContent = isDark ? "🌙" : "☀";
        modeText.textContent = isDark ? "DARK MODE" : "LIGHT MODE";

        localStorage.setItem("academicPortalTheme", theme);
        localStorage.setItem("studentInterfaceTheme", theme);
        localStorage.setItem("professorInterfaceTheme", theme);
        localStorage.setItem("secretaryInterfaceTheme", theme);
    }

    function showToast(message) {
        toastText.textContent = message;
        toast.classList.add("show");

        setTimeout(() => {
        toast.classList.remove("show");
        }, 3600);
    }

    themeToggle.addEventListener("click", () => {
        const nextTheme = body.classList.contains("dark") ? "light" : "dark";
        setTheme(nextTheme);
    });

    roleButtons.forEach((button) => {
        button.addEventListener("click", () => {
        selectedRole = button.dataset.role;

        roleButtons.forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        });
    });

    showPasswordBtn.addEventListener("click", () => {
        const isPassword = passwordInput.type === "password";

        passwordInput.type = isPassword ? "text" : "password";
        showPasswordBtn.textContent = isPassword ? "◌" : "◉";
    });

    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const email = document.getElementById("email").value.trim();
        const password = passwordInput.value.trim();
        const rememberMe = rememberMeInput.checked;

        if (!email || !password) return showToast("Enter credentials");

        const res = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, role: selectedRole, rememberMe })
        });

        const data = await res.json();

        if (res.ok) {
        window.location.href = data.redirect;
        } else {
        if (data.redirect) {
            window.location.href = data.redirect;
            return;
        }
        showToast(data.error || "Login failed. Check credentials.");
        }
    });

    teamsBtn.addEventListener("click", () => {
        showToast("Microsoft Teams login is not enabled yet.");
    });

    const savedTheme =
        localStorage.getItem("academicPortalTheme") ||
        localStorage.getItem("studentInterfaceTheme") ||
        localStorage.getItem("professorInterfaceTheme") ||
        localStorage.getItem("secretaryInterfaceTheme") ||
        "light";

    setTheme(savedTheme);

    const params = new URLSearchParams(window.location.search);
    if (params.get("verified") === "1") {
        showToast("Email verified. You can sign in now.");
    } else if (params.get("reset") === "1") {
        showToast("Password changed. You can sign in now.");
    } else if (params.get("error")) {
        showToast("The email link is invalid or expired.");
    }
});
