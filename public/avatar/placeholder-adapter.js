window.createPlaceholderAvatarAdapter = function createPlaceholderAvatarAdapter(container) {
  container.innerHTML = `
    <div class="avatar-shell">
      <div class="avatar-bubble">
        <div class="avatar-face">
          <span class="avatar-eye left"></span>
          <span class="avatar-eye right"></span>
          <span class="avatar-mouth"></span>
        </div>
      </div>
      <p class="avatar-caption">你好呀，我是心语。你可以把今天的心情慢慢告诉我。</p>
    </div>
  `;

  const caption = container.querySelector(".avatar-caption");

  return {
    setState(state) {
      container.dataset.expression = state?.expression ?? "calm";
      container.style.setProperty("--avatar-accent", state?.accent ?? "#4b8f8c");
      caption.textContent = state?.subtitle ?? "我在这里，随时听你说。";
    }
  };
};
