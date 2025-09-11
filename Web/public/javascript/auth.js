document.addEventListener("DOMContentLoaded", function () {
    const loginForm = document.getElementById("loginForm");
    const registerForm = document.getElementById("registerForm");
    const errorMessage = document.getElementById("errorMessage");

    async function sendRequest(url, data) {
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify(data)
            });

            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Something went wrong!");
            return result;
        } catch (error) {
            console.error(`[ERROR] ${url} →`, error.message);
            throw error;
        }
    }

    // 🔐 LOGIN
    if (loginForm) {
        loginForm.addEventListener("submit", async function (event) {
            event.preventDefault();
            const email = document.getElementById("email").value;
            const password = document.getElementById("password").value;

            try {
                const data = await sendRequest("./api/auth/login", { email, password });
                console.log(`[LOGIN] Success: ${email}`);
                console.log(`[REDIRECT] ${data.redirect}`)
                window.location.href = data.redirect;
            } catch (error) {
                errorMessage.textContent = error.message;
            }
        });
    }

    // ✍️ REGISTER
    if (registerForm) {
        document.getElementById('registerForm').addEventListener('submit', function(event) {
            event.preventDefault();

            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value.trim();

            if (!email || !password) {
                alert("Please fill in both email and password.");
                return;
            }

            fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            })
                .then(response => response.json())
                .then(data => {
                if (data.success) {
                    window.location.href = data.redirect;
                } else {
                    alert(data.error || "Register failed!");
                }
            })
            .catch(err => console.error('Error:', err));
        });
    }
});
