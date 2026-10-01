/**
 * BAGNEST - Cart Management System
 * Handles all cart operations via AJAX (Chaldal Style + / - Controls)
 */

$(document).ready(function() {
    console.log('🛒 Cart System Initialized');

    // ==========================================
    // 1. INITIAL LOAD - Update all quantities
    // ==========================================
    updateAllQuantities();
    updateCartCount();

    // ==========================================
    // 2. ADD BUTTON (Item Name এর পাশে - Home Page)
    // ==========================================
    $(document).on('click', '.btn-add-item', function() {
        const productId = $(this).data('product-id');
        const $btn = $(this);

        $btn.prop('disabled', true);
        $btn.html('<i class="fas fa-spinner fa-spin"></i>');

        $.ajax({
            url: '/api/cart/add',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ productId, quantity: 1 }),
            success: function(response) {
                if (response.success) {
                    // Update UI
                    updateCartCount();
                    updateQuantityDisplay(productId);

                   
                    $btn.hide();
                    const $controls = $(`#controls-${productId}`);
                    if ($controls.length) {
                        $controls.addClass('show');
                    }

                    // Show notification
                    if (response.isGuest) {
                        showNotification('💡 Added to guest cart! Login to checkout.', 'info');
                    } else {
                        showNotification('✅ Added to cart!', 'success');
                    }

                   
                    const $display = $(`#qty-${productId}`);
                    $display.addClass('bump');
                    setTimeout(() => $display.removeClass('bump'), 300);

                } else {
                    showNotification('❌ ' + response.message, 'error');
                }
                $btn.html('<i class="fas fa-plus"></i> Add');
                $btn.prop('disabled', false);
            },
            error: function() {
                showNotification('❌ Failed to add to cart', 'error');
                $btn.html('<i class="fas fa-plus"></i> Add');
                $btn.prop('disabled', false);
            }
        });
    });

 
    $(document).on('click', '.qty-plus', function() {
        const productId = $(this).data('product-id');
        const $btn = $(this);
        const $display = $(`#qty-${productId}`);

      
        $btn.prop('disabled', true);
        $btn.html('<i class="fas fa-spinner fa-spin"></i>');

        $.ajax({
            url: '/api/cart/add',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ productId, quantity: 1 }),
            success: function(response) {
                if (response.success) {
                    
                    const currentQty = parseInt($display.text()) || 0;
                    $display.text(currentQty + 1);
                    
                  
                    updateCartCount();
                    
                   
                    const $minusBtn = $(`.qty-minus[data-product-id="${productId}"]`);
                    $minusBtn.prop('disabled', false);

              
                    const $controls = $(`#controls-${productId}`);
                    if ($controls.length) {
                        $controls.addClass('show');
                    }
          
                    const $addBtn = $(`.btn-add-item[data-product-id="${productId}"]`);
                    if ($addBtn.length) {
                        $addBtn.hide();
                    }


                    if (response.isGuest) {
                        showNotification('💡 Added to guest cart! Login to checkout.', 'info');
                    } else {
                        showNotification('✅ Added to cart!', 'success');
                    }

                n
                    $display.addClass('bump');
                    setTimeout(() => $display.removeClass('bump'), 300);
                } else {
                    showNotification('❌ ' + response.message, 'error');
                }
            },
            error: function() {
                showNotification('❌ Failed to add to cart', 'error');
            },
            complete: function() {
                $btn.html('<i class="fas fa-plus"></i>');
                $btn.prop('disabled', false);
            }
        });
    });

  
    $(document).on('click', '.qty-minus', function() {
        const productId = $(this).data('product-id');
        const $btn = $(this);
        const $display = $(`#qty-${productId}`);
        const currentQty = parseInt($display.text()) || 0;


        if (currentQty <= 0) {
            showNotification('⚠️ Item not in cart', 'warning');
            return;
        }

        $btn.prop('disabled', true);
        $btn.html('<i class="fas fa-spinner fa-spin"></i>');

        $.ajax({
            url: '/api/cart/remove',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ productId }),
            success: function(response) {
                if (response.success) {
                    
                    const newQty = currentQty - 1;
                    $display.text(newQty);

               
                    updateCartCount();

                   
                    if (newQty <= 0) {
                        $btn.prop('disabled', true);
                        
                     
                        const $controls = $(`#controls-${productId}`);
                        if ($controls.length) {
                            $controls.removeClass('show');
                        }
                        const $addBtn = $(`.btn-add-item[data-product-id="${productId}"]`);
                        if ($addBtn.length) {
                            $addBtn.show();
                        }
                    }

                    showNotification('🗑️ Removed from cart', 'warning');

                  
                    $display.addClass('bump');
                    setTimeout(() => $display.removeClass('bump'), 300);
                } else {
                    showNotification('❌ ' + response.message, 'error');
                }
            },
            error: function() {
                showNotification('❌ Failed to remove from cart', 'error');
            },
            complete: function() {
                $btn.html('<i class="fas fa-minus"></i>');
                $btn.prop('disabled', false);
            }
        });
    });


    function updateQuantityDisplay(productId) {
        $.ajax({
            url: '/api/cart/view',
            type: 'GET',
            success: function(response) {
                if (response.success) {
                    const items = response.items || [];
                    const found = items.find(item => item.id === productId);
                    const qty = found ? found.quantity : 0;
                    
                
                    const $display = $(`#qty-${productId}`);
                    $display.text(qty);

                  
                    const $minusBtn = $(`.qty-minus[data-product-id="${productId}"]`);
                    if (qty <= 0) {
                        $minusBtn.prop('disabled', true);
                    } else {
                        $minusBtn.prop('disabled', false);
                    }

                    const $controls = $(`#controls-${productId}`);
                    const $addBtn = $(`.btn-add-item[data-product-id="${productId}"]`);
                    
                    if ($controls.length) {
                        if (qty > 0) {
                            $controls.addClass('show');
                            if ($addBtn.length) $addBtn.hide();
                        } else {
                            $controls.removeClass('show');
                            if ($addBtn.length) $addBtn.show();
                        }
                    }
                }
            }
        });
    }

  
    function updateAllQuantities() {
        $.ajax({
            url: '/api/cart/view',
            type: 'GET',
            success: function(response) {
                if (response.success) {
                    const items = response.items || [];

                  
                    $('.product-card').each(function() {
                        const productId = $(this).data('product-id');
                        const found = items.find(item => item.id === productId);
                        const qty = found ? found.quantity : 0;
                        
                      
                        const $display = $(`#qty-${productId}`);
                        $display.text(qty);

                       
                        const $minusBtn = $(`.qty-minus[data-product-id="${productId}"]`);
                        if (qty <= 0) {
                            $minusBtn.prop('disabled', true);
                        } else {
                            $minusBtn.prop('disabled', false);
                        }

                 
                        const $controls = $(`#controls-${productId}`);
                        const $addBtn = $(`.btn-add-item[data-product-id="${productId}"]`);
                        
                        if ($controls.length) {
                            if (qty > 0) {
                                $controls.addClass('show');
                                if ($addBtn.length) $addBtn.hide();
                            } else {
                                $controls.removeClass('show');
                                if ($addBtn.length) $addBtn.show();
                            }
                        }
                    });
                }
            },
            error: function() {
                console.log('⚠️ Failed to load cart quantities');
            }
        });
    }


    function updateCartCount() {
        $.ajax({
            url: '/api/cart/view',
            type: 'GET',
            success: function(response) {
                if (response.success) {
                    const count = response.count || 0;
                   
                    const $badge = $('#cartCount');
                    if ($badge.length) {
                        $badge.text(count);
                        if (count === 0) {
                            $badge.addClass('zero');
                        } else {
                            $badge.removeClass('zero');
                        }
                    }

               
                    const $mobileBadge = $('#mobileCartCount');
                    if ($mobileBadge.length) {
                        $mobileBadge.text(count);
                    }

                    const $guestCount = $('#guestCartCount');
                    if ($guestCount.length) {
                        $guestCount.text(count);
                    }
                }
            },
            error: function() {
                console.log('⚠️ Failed to update cart count');
            }
        });
    }

  
    window.updateCartCount = updateCartCount;
    window.updateAllQuantities = updateAllQuantities;
    window.updateQuantityDisplay = updateQuantityDisplay;


    function showNotification(message, type) {
        const container = $('#notificationContainer');
        const icons = {
            success: 'fa-check-circle',
            info: 'fa-info-circle',
            warning: 'fa-exclamation-triangle',
            error: 'fa-times-circle'
        };

        if (container.length === 0) {
            $('body').append(`
                <div id="notificationContainer" style="position:fixed;top:80px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:10px;max-width:400px;"></div>
            `);
        }

        const notification = $(`
            <div class="notification notification-${type}">
                <i class="fas ${icons[type] || 'fa-info-circle'}"></i>
                <span>${message}</span>
            </div>
        `);

        $('#notificationContainer').append(notification);

     
        setTimeout(() => {
            notification.fadeOut(300, function() {
                $(this).remove();
            });
        }, 3000);
    }


    window.searchProducts = function() {
        const query = $('#globalProductSearch').val().trim();
        if (query) {
            window.location.href = `/products?search=${encodeURIComponent(query)}`;
        }
    };

    
    $('#globalProductSearch').on('keypress', function(e) {
        if (e.which === 13) {
            searchProducts();
        }
    });


    window.toggleMobileMenu = function() {
        $('#mobileMenu').toggleClass('active');
    };


    $('<style>')
        .prop('type', 'text/css')
        .html(`
            .qty-display.bump {
                animation: bump 0.3s ease;
            }
            @keyframes bump {
                0% { transform: scale(1); }
                50% { transform: scale(1.5); color: #f39c12; }
                100% { transform: scale(1); }
            }
            .notification {
                padding: 12px 18px;
                border-radius: 10px;
                color: #fff;
                font-weight: 500;
                animation: slideIn 0.4s ease;
                box-shadow: 0 4px 20px rgba(0,0,0,0.2);
                display: flex;
                align-items: center;
                gap: 10px;
                font-size: 0.95rem;
            }
            .notification-success { background: linear-gradient(135deg, #27ae60, #2ecc71); }
            .notification-info { background: linear-gradient(135deg, #2980b9, #3498db); }
            .notification-warning { background: linear-gradient(135deg, #f39c12, #e67e22); }
            .notification-error { background: linear-gradient(135deg, #c0392b, #e74c3c); }
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `)
        .appendTo('head');

    console.log('✅ Cart System Ready!');
});