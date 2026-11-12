const generateBtn = document.getElementById("generateBtn");
const results = document.getElementById("results");

function generateMenu() {

    const budget =
        document.getElementById("budget").value;

    const meals =
        document.getElementById("meals").value;

    const people =
        document.getElementById("people").value;

    results.innerHTML = `
        <h3>Menu généré ✅</h3>

        <p>Budget : ${budget} €</p>

        <p>Nombre de repas : ${meals}</p>

        <p>Nombre de personnes : ${people}</p>
    `;
}

generateBtn.addEventListener(
    "click",
    generateMenu
);
