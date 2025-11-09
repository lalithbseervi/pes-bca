import { API_BASE_URL } from './utils.js';

document.getElementById('contact-form').addEventListener('submit', async function (e) {
    e.preventDefault(); 

    const socialId = document.getElementById('social_id').value;
    const responseMessage = document.getElementById('response-message');

    // Validate input
    if (!socialId) {
        responseMessage.textContent = "Please enter your social ID.";
        return;
    }

    try {
        // Sending data to the Cloudflare Worker
        const response = await fetch(API_BASE_URL + '/api/contribute', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ social_id: socialId }),
        });

        // Handling the response from the worker
        if (response.ok) {
            let response_body = await response.text()
            responseMessage.textContent = "We have received your ID.";
            window.alert(response_body)
        } else {
            responseMessage.textContent = "There was an error. Please try again later.";
        }
    } catch (error) {
        responseMessage.textContent = "Failed to connect. Please try again later.";
    }
});
