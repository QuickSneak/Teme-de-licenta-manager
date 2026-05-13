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

        if (!email || !password) return showToast("Enter credentials");

        const res = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, role: selectedRole })
        });

        if (res.ok) {
        const data = await res.json();
        window.location.href = data.redirect;
        } else {
        showToast("Login failed. Check credentials.");
        }
    });

    teamsBtn.addEventListener("click", () => {
        let destination;
        
        switch(selectedRole) {
            case "student":
                destination = "professors.html";
                break;
            case "professor":
                destination = "professor-dashboard.html";
                break;
            case "secretary":
                destination = "secretary-dashboard.html";
                break;
            default:
                destination = "professors.html";
        }

        showToast(`Microsoft Teams login selected for ${selectedRole}. Redirecting...`);

        setTimeout(() => {
        window.location.href = destination;
        }, 700);
    });

    const savedTheme =
        localStorage.getItem("academicPortalTheme") ||
        localStorage.getItem("studentInterfaceTheme") ||
        localStorage.getItem("professorInterfaceTheme") ||
        localStorage.getItem("secretaryInterfaceTheme") ||
        "light";

    setTheme(savedTheme);
});